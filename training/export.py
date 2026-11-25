#!/usr/bin/env python3
"""Export a fine-tuned model to the layout Transformers.js loads.

    python training/export.py [--model training/out/model] [--out training/out/locator-model]

Produces:

    locator-model/
      config.json, tokenizer.json, tokenizer_config.json, ...
      onnx/model.onnx            full precision (~90 MB)
      onnx/model_quantized.onnx  8-bit (~23 MB) - what the server loads (dtype "q8")

This matches Xenova/all-MiniLM-L6-v2 on the Hugging Face Hub: inputs
input_ids / attention_mask / token_type_ids, output last_hidden_state,
dynamically quantised int8 weights (per channel). The export is checked
against PyTorch, and the quantised file against full precision; either
check failing stops the export. Pooling (mean) and normalisation are
done by the server, so they are not baked in.

Point the server at the result with WEBMCP_LOCATOR_MODEL=<path or Hub id>.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", type=Path, default=HERE / "out" / "model")
    p.add_argument("--out", type=Path, default=HERE / "out" / "locator-model")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModel, AutoTokenizer

    if not (args.model / "config.json").exists():
        raise SystemExit(f"{args.model} has no config.json; run training/train.py first")

    if args.out.exists():
        shutil.rmtree(args.out)
    onnx_dir = args.out / "onnx"
    onnx_dir.mkdir(parents=True)

    # A SentenceTransformer save keeps the underlying transformer (config,
    # weights, tokenizer) at the top level, so it loads as a plain model.
    tokenizer = AutoTokenizer.from_pretrained(str(args.model))
    # "eager" attention traces to a plain graph; the default (SDPA) builds its
    # mask with shape-dependent Python code that does not survive tracing.
    model = AutoModel.from_pretrained(str(args.model), attn_implementation="eager").eval()
    model.config.save_pretrained(str(args.out))
    tokenizer.save_pretrained(str(args.out))

    sample = tokenizer(CHECK_TEXTS[:2], padding=True, return_tensors="pt")
    names = ["input_ids", "attention_mask", "token_type_ids"]
    inputs = tuple(sample[n] for n in names)

    class LastHiddenState(torch.nn.Module):
        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, input_ids, attention_mask, token_type_ids):
            return self.inner(
                input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids
            ).last_hidden_state

    dynamic = {0: "batch_size", 1: "sequence_length"}
    # The wrapper must be in eval mode too: export restores the wrapper's mode
    # afterwards, recursively, which would otherwise switch dropout back on in
    # the model the checks below use.
    torch.onnx.export(
        LastHiddenState(model).eval(),
        inputs,
        str(onnx_dir / "model.onnx"),
        input_names=names,
        output_names=["last_hidden_state"],
        dynamic_axes={**{n: dynamic for n in names}, "last_hidden_state": dynamic},
        opset_version=17,
        dynamo=False,
    )

    # Per-channel scales keep the 8-bit model close to full precision (pooled
    # cosine ~0.98 here, against ~0.91 with one scale per tensor).
    quantize_dynamic(
        model_input=str(onnx_dir / "model.onnx"),
        model_output=str(onnx_dir / "model_quantized.onnx"),
        weight_type=QuantType.QInt8,
        per_channel=True,
    )

    check_export(model, tokenizer, onnx_dir, names)

    for f in sorted(onnx_dir.iterdir()):
        print(f"{f.relative_to(args.out)}  {f.stat().st_size / 1e6:.1f} MB")
    print(f"exported to {args.out}")


CHECK_TEXTS = [
    "sign in",
    "button, text: Proceed to Checkout",
    "email input, placeholder: you@example.com, name: email",
    "a much longer description with many more tokens than the others in this batch",
]
# Minimum cosine between the quantised and full-precision pooled embeddings.
MIN_QUANTISED_COSINE = 0.97


def check_export(model, tokenizer, onnx_dir: Path, names: list[str]) -> None:
    """Fail loudly unless the exported files reproduce the PyTorch model.

    Only real tokens are compared: padding positions come out differently
    after export and do not matter, because the server's mean pooling
    ignores them.
    """
    import numpy as np
    import onnxruntime as ort
    import torch

    model.eval()  # no dropout in the reference output
    batch = tokenizer(CHECK_TEXTS, padding=True, return_tensors="pt")
    mask = batch["attention_mask"].numpy()[..., None]
    with torch.no_grad():
        expected = model(**{n: batch[n] for n in names}).last_hidden_state.numpy()

    def run(file: str) -> np.ndarray:
        session = ort.InferenceSession(str(onnx_dir / file), providers=["CPUExecutionProvider"])
        return session.run(None, {n: batch[n].numpy() for n in names})[0]

    def pooled(hidden: np.ndarray) -> np.ndarray:
        p = (hidden * mask).sum(1) / mask.sum(1)
        return p / np.linalg.norm(p, axis=1, keepdims=True)

    full = run("model.onnx")
    worst = float(np.abs((full - expected) * mask).max())
    if worst > 1e-3:
        raise SystemExit(f"onnx/model.onnx differs from PyTorch by up to {worst:.2e}")

    cosine = float((pooled(run("model_quantized.onnx")) * pooled(full)).sum(1).min())
    if cosine < MIN_QUANTISED_COSINE:
        raise SystemExit(
            f"onnx/model_quantized.onnx drifts too far from full precision "
            f"(pooled cosine {cosine:.3f} < {MIN_QUANTISED_COSINE})"
        )
    print(f"checks passed: full precision within {worst:.1e} of PyTorch; quantised pooled cosine {cosine:.3f}")


if __name__ == "__main__":
    main()

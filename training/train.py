#!/usr/bin/env python3
"""Fine-tune the locator's sentence-embedding model on description→element pairs.

    python training/train.py [--triplets training/out/triplets.jsonl] [--out training/out/model]

Input is the output of prepare.mjs: one {anchor, positive, negative} row per
(description, right element, wrong element from the same page). The loss is
MultipleNegativesRankingLoss: for each description, the right element must
score above its listed wrong element *and* above every other element in the
batch. Same-page wrong elements are the hard cases ("Log in" vs "Sign up");
the rest of the batch keeps the model from forgetting easy ones.

Runs on CPU in a few minutes for the bundled dataset; a GPU is used if present.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

# PyTorch weights for the same model the server runs as Xenova/all-MiniLM-L6-v2.
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--triplets", type=Path, default=HERE / "out" / "triplets.jsonl")
    p.add_argument("--out", type=Path, default=HERE / "out" / "model")
    p.add_argument("--base-model", default=BASE_MODEL)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=2e-5)
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()


def load_rows(path: Path) -> list[dict[str, str]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                r = json.loads(line)
                # Column order matters to the loss: anchor, positive, negative.
                rows.append({"anchor": r["anchor"], "positive": r["positive"], "negative": r["negative"]})
    if not rows:
        raise SystemExit(f"{path} has no rows; run `node training/prepare.mjs` first")
    return rows


def main() -> None:
    args = parse_args()

    # Imported here so --help works without the heavy dependencies installed.
    from datasets import Dataset
    from sentence_transformers import (
        SentenceTransformer,
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
        losses,
    )
    from sentence_transformers.training_args import BatchSamplers

    random.seed(args.seed)
    rows = load_rows(args.triplets)
    dataset = Dataset.from_list(rows).shuffle(seed=args.seed)

    model = SentenceTransformer(args.base_model)
    loss = losses.MultipleNegativesRankingLoss(model)

    training_args = SentenceTransformerTrainingArguments(
        output_dir=str(args.out / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.lr,
        warmup_ratio=0.1,
        seed=args.seed,
        # The same description appears in several rows (one per wrong
        # element); two copies in one batch would each count the other's
        # right answer as wrong.
        batch_sampler=BatchSamplers.NO_DUPLICATES,
        save_strategy="no",
        logging_steps=10,
        report_to=[],
    )

    trainer = SentenceTransformerTrainer(model=model, args=training_args, train_dataset=dataset, loss=loss)
    trainer.train()

    args.out.mkdir(parents=True, exist_ok=True)
    model.save(str(args.out))
    print(f"saved fine-tuned model to {args.out}")


if __name__ == "__main__":
    main()

# Fine-tuning the locator model

`get_element_locator` ranks elements by how close their meaning is to your
description, using a small sentence-embedding model
(`Xenova/all-MiniLM-L6-v2`). This folder retrains that model on examples of
descriptions and the elements they mean, exports it in the format the server
loads, and measures whether it helped.

Training can run anywhere with Python (a laptop CPU takes about a minute for
the bundled data; a GPU is used if present). The result is a 23 MB folder you
store wherever suits you and point the server at.

## What it changes, measured

On the held-out set (20 descriptions of BenchmarkShop controls, none of them in
the training data), three training runs with different seeds:

| Matcher | Descriptive ids | Neutral ids (`el0`, `el1`, …) | Unrelated descriptions answered |
|---|---|---|---|
| Keyword only | 8/20 | 3/20 | 0/5 |
| Stock model | 14/20 | 12/20 | 0/5 |
| Fine-tuned | 17–18/20 | 14–15/20 | 0/5 |

It fixed "basket" vs "cart" style misses. It still confuses "sign up" with a
"Sign In" button and "complete purchase" with "Continue to Payment".

Treat these numbers as a smoke test, not a benchmark: both sets are small and
were written by the same person, so they share a style. Real descriptions from
your users, added to `data/`, are what make the model, and the score, worth
trusting. See [Growing the data](#growing-the-data).

## Pipeline

```
data/train.jsonl ──prepare.mjs──▶ out/triplets.jsonl ──train.py──▶ out/model ──export.py──▶ out/locator-model
data/eval.jsonl  ─────────────────────────────────────────────────────────────── evaluate.mjs ◀──┘
```

| Step | What it does |
|---|---|
| `prepare.mjs` | Checks both datasets (unknown keys, look-alike elements, evaluation descriptions leaking into training) and writes training rows. Element text comes from the server's own `describeElement`, so the model trains on exactly the strings it compares at run time. |
| `train.py` | Fine-tunes `sentence-transformers/all-MiniLM-L6-v2`. Each description must score its element above every other element on the same page, and above the rest of the batch. |
| `export.py` | Writes ONNX in the layout Transformers.js loads, with an 8-bit copy. Fails if the export doesn't reproduce the PyTorch output, or if the 8-bit copy drifts from full precision. |
| `evaluate.mjs` | Compares keyword matching, the stock model and any models you name on the held-out set, through the same code the server uses, and recommends a similarity threshold. |

## Running it

```bash
# Once: Python dependencies (CPU-only PyTorch shown; drop --index-url for CUDA)
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r training/requirements.txt

npm run train:prepare                 # check data, write out/triplets.jsonl
python training/train.py              # → training/out/model
python training/export.py             # → training/out/locator-model
npm run train:evaluate -- --model Xenova/all-MiniLM-L6-v2 --model training/out/locator-model
```

`train.py` takes `--epochs`, `--batch-size`, `--lr` and `--seed`. Outputs go to
`training/out/`, which git ignores.

If a Hugging Face download hangs behind a proxy, set `HF_HUB_DISABLE_XET=1`.
On Node's side, `NODE_USE_ENV_PROXY=1` makes it honour `HTTPS_PROXY`.

## Using the model

Two settings on the MCP server:

| Variable | Value |
|---|---|
| `WEBMCP_LOCATOR_MODEL` | A local folder (the `export.py` output) or a Hugging Face model id |
| `WEBMCP_LOCATOR_MIN_SIMILARITY` | The threshold `evaluate.mjs` prints for that model |

The threshold matters because a fine-tuned model scores on its own scale. Below
it, a description that matches nothing on the page gets a confident answer
anyway. `evaluate.mjs` picks the lowest value that rejects every unrelated
description in the evaluation set, plus a margin.

For example, in a Claude Desktop config:

```json
{
  "mcpServers": {
    "webmcp-selenium": {
      "command": "node",
      "args": ["/path/to/build/index.js"],
      "env": {
        "WEBMCP_LOCATOR_MODEL": "/models/locator-model",
        "WEBMCP_LOCATOR_MIN_SIMILARITY": "0.16"
      }
    }
  }
}
```

A local folder is loaded only from disk; it never falls back to a Hub
repository of the same name.

## Storing the model

The model is a build output (23 MB for the 8-bit file the server loads,
90 MB with the full-precision copy), so keep it out of git. Options:

- **Hugging Face Hub (private repository)**: easiest to share. Upload the
  folder, then set `WEBMCP_LOCATOR_MODEL` to the repository id. For a private
  repository, also set `HF_TOKEN` on the server.

  ```bash
  hf upload your-org/webmcp-locator training/out/locator-model . --private
  # older huggingface_hub releases: huggingface-cli upload … (same arguments)
  ```

- **GitHub release asset or shared storage**: archive the folder, attach it to
  a release (or put it on a shared drive or bucket), and have machines unpack
  it to a local path that `WEBMCP_LOCATOR_MODEL` points at.

Record which data and seed produced each upload. The evaluation output is a
good thing to paste into the release notes.

## Growing the data

Both files are JSON Lines, one page per line:

```json
{"page": "auth-login",
 "elements": [{"key": "go", "tag": "button", "text": "Log in"},
              {"key": "join", "tag": "a", "text": "Sign up for free"}],
 "queries": [["sign in button", "go"], ["create new account", "join"]]}
```

- **Elements** use the fields the crawler records: `tag`, `text`, `ariaLabel`,
  `role`, `id`, and `attributes` (`type`, `placeholder`, `name`, `title`,
  `alt`). `key` only names the element for `queries`.
- **Queries** pair a description someone might give with the key of the element
  it means. Several phrasings per element help most: the words people really use.
- **Other elements on the page** are what the model learns to rank below the
  right one, so include the near misses that matter ("Log in" next to
  "Sign up"), not just the target.
- `eval.jsonl` pages can add `"unrelated": [...]`: descriptions that match
  nothing, used to set the threshold.

`prepare.mjs` refuses data that would mislead: two elements that look identical
to the model, a query pointing at an unknown key, or a training description
that is also in the evaluation set. The unit tests run the same checks on the
bundled files.

The most valuable additions are real `get_element_locator` calls that went
wrong, with the element that was meant. Add them to `train.jsonl`, and keep a
separate set from other sites in `eval.jsonl` so the score stays honest.

## Scope

This retrains the server-side model used by `get_element_locator`. The
in-page analyzer (`src/analyzer.ts`) runs its own copy of the stock models in
the browser to merge duplicate elements; it doesn't read these settings.

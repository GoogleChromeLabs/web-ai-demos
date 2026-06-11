# Eval Comparison: Local LLM Judge vs Human Reference

This compares the results of a local LLM judge against a reference dataset to evaluate the LLM's performance on a specific task. It uses llama-cli to run the local LLM judge and outputs the results to a JSON file.

## Quickstart

1. Install llama-cli

```bash
brew install llama-cli
```

2. Run the comparison script

```bash
node compare_judge.js
```

## Results and learnings

See https://www.linkedin.com/posts/maudnalpas_buildinpublic-webdev-generativeai-activity-7470455380922404865-Wijr

## Project structure

* `compare_judge.js`: The main evaluation script that invokes `llama-cli`.
* `reference-dataset.jsonc`: The reference dataset, currently using evaluations by Gemini Flash (cloud).
* `few-shots.jsonc`: 3 few-shot examples utilized in the prompt templates.
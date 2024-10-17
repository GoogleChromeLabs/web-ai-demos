# LLM Summary generation evaluation

This application demonstrates the LLM as a judge technique to evaluate the output of different
models for generating summaries for news articles. This approach can be used for different use
cases.

## Dependencies
 - [Bun][2]
 - [Ollama][3]

## Preparation

### Get the code
Clone this application with `git clone` then, from the cloned directory run `bun install`.
Make sure to make acopy `.env.example` as `.env`.

### Get an API key for Google AI Studio
Go to [Google AI Studio][4] and get an API key, then your `.env` file with the key.

### Download and unzip the articles
Download the raw text files dataset from [ML Resources][1] containing the 2225 BBC articles and
decompress them in a directory in your computer. Take note of the directory where the articles were
unzipped.

Load the articles into a local database SQLLite database using
`bun run bin/ArticleLoader.ts <path-to-unzipped-articles)`.

### Install the relevant models into Ollama
Download install start an [Ollama][3]. Once installed, the tool will be available as a command-line
tool, `ollama` and via a REST API that defaults to `http://localhost:11434`.

Once installed, ensure models that are going to be tested are installed:
 1. `ollama pull gemma:2b`
 2. `ollama pull gemma2:2b`

The example `.env` file uses `http://localhost:11434`. If using a different server or port, make
sure to update your configuration.

## Generate summaries for different models

### Gemini 1.5 Flash
Run `bun run bin/GeminiFlashSummarizer.ts` to generate summaries for the Gemini 1.5 Flash model.

### Gemma:2b and Gemma2:2b
 - Run `bun run bin/OllamaSummarizer.ts gemma:2b` to generate summaries for the Gemma 2b model.
 - Run `bun run bin/OllamaSummarizer.ts gemma2:2b` to generate summaries for the Gemma 2 2b model.

## Run the evaluation
Run `bun run bin/SummaryEvaluator.ts` generate scores for all generated summaries. The raw results
will be availabe in the `ALIGNMENT_VERDICT`, in the SQLLite database.

You can query the SQLLite database with the following query for a report:

```sql
SELECT 
    s.MODEL, 
    COUNT(DISTINCT CASE WHEN av.VERDICT = 'no' THEN s.ID END) as num_no_verdicts, 
    COUNT(DISTINCT s.ID) as total_summaries,
    CAST(COUNT(av.SUMMARY_ID) AS FLOAT) / COUNT(DISTINCT s.ID) AS richenss,
    100 * (1 - (CAST(COUNT(DISTINCT CASE WHEN av.VERDICT = 'no' THEN s.ID END) as FLOAT)/CAST(COUNT(DISTINCT s.ID) as FLOAT))) AS alignment
FROM 
    SUMMARY s
LEFT JOIN 
    ALIGNMENT_VERDICT av ON s.ID = av.SUMMARY_ID
GROUP BY 
    s.MODEL;
```

[1]: http://mlg.ucd.ie/datasets/bbc.html
[2]: https://bun.sh/
[3]: https://ollama.com/
[4]: https://aistudio.google.com/
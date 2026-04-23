# Applied evals for web developers

Example evals system that evaluates AI-generated outputs, including rule-based checks and LLM-as-a-judge checks.

## Running the eval service

> [!IMPORTANT]
> All commands must be run from within the `evals-service` directory.

1. Navigate to the evals service directory: `cd evals-service`
2. Create an `.env` file with your `GEMINI_API_KEY`.
3. Install dependencies: `npm install`
4. Run the service: `npm start` (or `npm run dev` for development)
   -  Note: The service runs on **port 8080** by default.

## Evals tests

Make sure you are inside the `evals-service` directory before running these commands.

Run rule-based evaluations:
```bash
npm run test:rule-based-evals
```

Run LLM-as-a-judge evaluations:
```bash
npm run test:llm-judge-evals
```

Run basic LLM-as-a-judge evaluations (alignment% only):
```bash
npm run test:llm-judge-basic-evals
```

Run unit testing:
```bash
npm run test:unit-evals
```

### Running LLM evals with a custom dataset

The LLM evaluation scripts use a default dataset, but you can override this by passing a custom path either as a CLI argument or via the `DATASET_PATH` environment variable.

**Option 1: CLI argument**
You can pass the file path directly to the script:
```bash
npx ts-node test/test-llm-judge-alignment-bootstrap.ts ../data/my-custom-dataset.jsonc
```
*(You can also use the `--fast` flag for quick debugging: `npx ts-node test/test-llm-judge-alignment-bootstrap.ts --fast ../data/my-custom-dataset.jsonc`)*

**Option 2: Environment variable**
You can also set the `DATASET_PATH` variable:
```bash
DATASET_PATH="../data/my-custom-dataset.jsonc" npx ts-node test/test-llm-judge-alignment.ts
```

## Example usage

Once the service is running, you can evaluate data by sending a POST request to `/api/evaluate`.

Here is an example using `curl`:

```bash
curl -X POST http://localhost:8080/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "id": "brand-003",
        "userInput": {
          "companyName": "Loom",
          "description": "A boutique textile mill specializing in traditional indigo-dyeing and hand-loomed linens.",
          "audience": "interior designers and slow-fashion advocates",
          "tone": ["tactile", "minimalist", "earthy"]
        },
        "appOutput": {
          "motto": "Woven by hand and time.",
          "colorPalette": {
            "textColor": "#262626",
            "backgroundColor": "#F5F5F4",
            "primary": "#312E81",
            "secondary": "#A8A29E"
          }
        }
      }
    ]
  }'
```

This will return an evaluation result containing the format validation label and several LLM-as-a-judge checks.

For example:

```json
{
  "results": [
    {
      "id": "brand-003",
      "dataFormat": {
        "label": "PASS",
        "rationale": "Format is valid."
      },
      "mottoBrandFit": {
        "label": "PASS",
        "rationale": "The motto aligns perfectly with the brand's commitment to slow craftsmanship and tradition. 'Woven by hand' emphasizes the tactile and artisanal nature of the product, while 'time' appeals to the slow-fashion ethos. The brevity of the phrase maintains a minimalist and sophisticated tone suitable for the target audience."
      }
    }
  ],
  "modelVersion": "gemini-3-flash-preview"
}
```

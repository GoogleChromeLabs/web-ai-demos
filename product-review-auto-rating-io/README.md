# Product review auto-rating (I/O 2024)

Demo for [I/O Talk 2024](https://www.youtube.com/watch?v=VDtgyEB9Q_Q).

The input is a user review, based on which we generate:
* Automatic star rating
* Sentiment analysis
* Toxicity analysis

<p align="center">
  <img src="https://github.com/user-attachments/assets/938e9f27-f8cf-4479-a0c2-1bf234fbc1af" width="400"/>
  <div align="center">Positive review</div>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/0987e08b-9b42-4172-854d-1ede0c9b1391" width="400"/>
  <div align="center">Negative, toxic review</div>
</p>


## Get started
* [Only once, or when new env variables are added] Set up environment variables:
  * Create an `.env.development.local` file that follows the structure documented in `.env.template`.
  * Fill in the values in `.env.development.local`. No quotes are needed. Googlers: Ask your teammates for the `VITE_GEMMA_MODEL_PATH` value we use.
* [Only once, or when dependencies are updated] Run `npm install`.
* Run `npm run dev`. The project is running!

## Build for deployment
* [Only once, or when new env variables are added]:
  * Create an `.env.production.local` file that follows the structure documented in `.env.template`.
  * Fill in the values in `.env.production.local`. No quotes are needed. Googlers: Ask your teammates for the `VITE_GEMMA_MODEL_PATH` value we use. 
* Run `npm run build`, then run `npm run preview` and check that your changes don't include a regression.

## About vite env variables
* 🚨 Important: `local` in the env file name ensures that the env file is gitignored.
* If you introduce new env variables other developers will need, make sure to include them in `.env.template` in your PR. To prevent accidentally leaking env variables to the client, only variables prefixed with `VITE_` are exposed to your Vite-processed code.

Learn more about vite env variables [here](https://vitejs.dev/guide/env-and-mode).

## Known issues
The Transformers.js model will download at each page load.
Issue: https://github.com/xenova/transformers.js/issues/366
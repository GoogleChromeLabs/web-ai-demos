# A Cloud function providing Gemini-powered ratings based on user reviews

## Develop

```
npm run dev
```

## Deploy

Make sure you're logged in and that you use the right Cloud project:

```
gcloud auth login
gcloud config list
```

Deploy your function:

```
gcloud functions deploy product-reviews-gemini-get-rating  --runtime nodejs20 --trigger-http
```

## Use in the product-reviews frontend app

Set VITE_GEMINI_RATING_ENDPOINT in ../.env (at the root directory) to the function's URL.
# Right click for superpowers with Gemma 2B LLM

## How to run

Serve these 3 files from your local webserver in folder of your choice, and then navigate to index.html to try the demo. Note this will download a 1.3GB file so be on good WiFi :-)

## Not just another chat app

This demo shows how to add utility to a webpage utilizing an LLM (Google's Gemma 2B) to perform common useful tasks like summarisation, translation, or defining words or phrases in a manner that is then easier to understand.

![alt text](https://github.com/jasonmayes/web-ai-demos/blob/main/right-click-for-superpowers/demo_llm.gif?raw=true)

This demo is by no means perfect for the prompt engineering, and results may not be correct for all use cases - further work would be needed to use in any production use case such as fine tuning the model or distilling from a model that works well for your specific usecase.

You could however envision something like this being turned into a Chrome extension to work accross websites and have the model file cached so fast to load on startup after the first download.

## Notes

This demo purposely does not cache the LLM model as this is to demonstrate code use only. 

You would need to download and host your own version of the Gemma model from Kaggle to enable caching for your own applications from:

https://www.kaggle.com/models/google/gemma/tfLite/gemma-2b-it-gpu-int4

And then update the script.js code to point to your hosted version of the model instead.

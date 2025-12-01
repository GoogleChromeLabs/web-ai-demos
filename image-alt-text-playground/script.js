const progress = document.querySelector('progress');

let sessionCreationTriggered = false;

const createSession = async (options = {}) => {
  if (sessionCreationTriggered) {
    return;
  }

  progress.hidden = true;
  progress.value = 0;

  try {
    if (!('LanguageModel' in self)) {
      throw new Error('LanguageModel is not supported.');
    }

    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('LanguageModel is not available.');
    }

    let modelNewlyDownloaded = false;
    if (availability !== 'available') {
      modelNewlyDownloaded = true;
      progress.hidden = false;
    }
    sessionCreationTriggered = true;

    const llmSession = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progress.value = e.loaded;
          if (modelNewlyDownloaded && e.loaded === 1) {
            // The model was newly downloaded and needs to be extracted
            // and loaded into memory, so show the undetermined state.
            progress.removeAttribute('value');
          }
        });
      },
      ...options,
    });

    sessionCreationTriggered = false;
    return llmSession;
  } catch (error) {
    throw error;
  } finally {
    progress.hidden = true;
    progress.value = 0;
  }
};

const template = document.querySelector('template');

const images = [
  {
    src: 'captcha.jpg',
    width: 240,
    height: 86,
    prompt: "Solve this captcha. Only return the captcha's value.",
    caption:
      'A captcha consisting of a cluster of colorful numbers and letters floating against a light blue background. The captcha says "6138B. There are various other indistinct letters and symbols scattered around, in colors like green, purple, pink, and light blue.',
  },
  {
    src: 'chart.png',
    width: 640,
    height: 560,
    prompt: 'Interpret the overall message conveyed in this chart.',
    caption:
      'A bar chart illustrating the relative risk of Post-Traumatic Seizures (PTS) following a Traumatic Brain Injury (TBI) across three severity levels, revealing a dramatic escalation in risk as severity increases. While the relative risk for mild and moderate TBI is comparatively low at 1.5 and 2.9 respectively, it spikes significantly to 17.2 for severe TBI, indicating that severe injuries carry a risk roughly six times higher than moderate ones and over eleven times higher than mild ones.',
  },
  {
    src: 'woman.jpg',
    width: 640,
    height: 960,
    prompt:
      'Describe this person, including gender, approximate age, and ethnicity.',
    caption:
      'A young woman with shoulder-length curly hair standing against a plain, off-white background. Her ethnicity appears to be mixed, possibly African and European. She is dressed in professional business attire, featuring a white blouse with a silver zipper and a black skirt, while holding a black blazer draped over her right shoulder. With her left hand resting on her hip, she gazes directly at the camera with a neutral expression, accessorized by gold hoop earrings and a thin necklace.',
  },
  {
    src: 'david.jpg',
    width: 960,
    height: 889,
    prompt: 'Describe this statue for a blind person.',
    caption:
      "A low-angle photograph of Michelangelo'ss David, the renowned Renaissance marble sculpture. Key visual elements include a heroic, nude male figure standing in a contrapposto pose, creating a sense of relaxed tension.",
  },
  {
    src: 'data:image/svg+xml;charset=UTF-8,<svg%20xmlns%3D"http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg"%20width%3D"800"%20height%3D"450"%20viewBox%3D"0%200%20800%20450">%20<rect%20fill%3D"Canvas"%20width%3D"800"%20height%3D"450"%2F>%20<text%20fill%3D"CanvasText"%20font-family%3D"sans-serif"%20font-size%3D"90"%20font-weight%3D"bold"%20x%3D"50%25"%20y%3D"50%25"%20text-anchor%3D"middle">Open image<%2Ftext>%20<%2Fsvg>',
    width: 800,
    height: 450,
    placeholder: 'Your prompt here…',
    caption: 'Test alternative text generation with your own images.',
  },
];

for (const image of images) {
  const clone = template.content.cloneNode(true);
  const form = clone.querySelector('form');
  const img = form.querySelector('img');
  img.src = image.src;
  img.width = image.width;
  img.height = image.height;
  const figcaption = form.querySelector('figcaption');
  figcaption.textContent = image.caption;
  const input = form.querySelector('input');
  if (image.prompt) {
    input.value = image.prompt;
  } else {
    input.placeholder = image.placeholder;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open image';
    button.classList.add('open-button');
    button.addEventListener('click', async () => {
      await imageOpen(img);
    });
    form.insertBefore(button, form.querySelector('label'));
  }
  const output = form.querySelector('output');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!img.src || !input.value.trim()) {
      return;
    }

    output.innerHTML = '';
    const session = await createSession({
      expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [
        {
          role: 'system',
          content:
            'Your task is to describe images. Only use plain text. Do not use Markdown. Be short and precise.',
        },
      ],
    });
    try {
      const stream = session.promptStreaming([
        {
          role: 'user',
          content: [
            {
              value: input.value,
              type: 'text',
            },
            {
              value: img,
              type: 'image',
            },
          ],
        },
      ]);
      for await (const chunk of stream) {
        output.append(chunk);
      }
    } catch (err) {
      output.textContent = err.message;
    }
  });
  document.body.append(form);
}

const imageOpen = async (img) => {
  try {
    const [handle] = await showOpenFilePicker({
      startIn: 'pictures',
      types: [
        {
          description: 'Image files',
          accept: {
            'image/*': [
              '.jpg',
              '.jpeg',
              '.avif',
              '.webp',
              '.png',
              '.apng',
              '.jxl',
              '.gif',
              '.svg',
              '.bmp',
            ],
          },
        },
      ],
    });
    const blobURL = URL.createObjectURL(await handle.getFile());
    img.addEventListener('load', () => {
      URL.revokeObjectURL(blobURL);
    });
    img.src = blobURL;
  } catch (error) {
    console.error(error);
  }
};

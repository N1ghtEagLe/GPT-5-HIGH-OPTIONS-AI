Here’s a practical, no-nonsense guide to making the model “see” your images (including screenshots) via the Responses API and, if you need low-latency sessions, the Realtime API.

How image inputs work (what the model expects)

To send images, you must use the “conversation” shape of the Responses API where input is an array of messages. Inside a user message, you pass content parts such as:

{"type": "input_text", "text": "..."}

{"type": "input_image", "image_url": "...", "detail": "auto|low|high"}
This is the officially documented pattern for vision with the Responses API / SDKs. 
GitHub
+1

Images can be provided either as:

A public https URL, or

A data URL (data:image/<mime>;base64,<data>) if you’re sending a local file. The official Python SDK README shows both patterns. 
GitHub

Screenshots are fine—they’re just images. OpenAI explicitly calls out screenshots as valid inputs (and a great use case) in the Realtime announcement. 
OpenAI

The detail parameter (resolution/cost control)

For each input_image, you can set "detail" to auto (default), low, or high to trade off speed/cost vs. fidelity. (This parameter is referenced across OpenAI docs and examples; some developers have discussed behavior changes for specific models like gpt-5, so treat it as a tunable knob rather than a guarantee.) 
GitHub
+2
OpenAI Community
+2

When to use which

low: thumbnails, layout, dominant color/shape, quick lookups

high: small text in images, dense UI screenshots, technical diagrams

auto: let the model choose

Minimal, correct request shapes
Python (async) — single image + text
import os, asyncio, base64
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

async def analyze_image(prompt: str, img_path: str):
    # encode local file -> data URL (works for screenshots too)
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    data_url = f"data:image/png;base64,{b64}"

    resp = await client.responses.create(
        model="gpt-5",
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": data_url, "detail": "auto"}
            ],
        }],
    )
    return resp.output_text  # convenience property

if __name__ == "__main__":
    print(asyncio.run(analyze_image(
        "What does this screenshot show? Summarize in 3 bullets.",
        "screenshot.png"
    )))


The official SDK documents AsyncOpenAI and the exact input_text / input_image pattern above. 
GitHub

Python (async) — multiple images in one turn
async def compare_images(prompt: str, img_paths: list[str]):
    contents = [{"type": "input_text", "text": prompt}]
    for p in img_paths:
        with open(p, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        contents.append({
            "type": "input_image",
            "image_url": f"data:image/png;base64,{b64}",
            "detail": "high"
        })

    resp = await client.responses.create(
        model="gpt-5",
        input=[{"role": "user", "content": contents}],
    )
    return resp.output_text


Just add more input_image parts to the same message; order matters. 
GitHub

Node.js (ESM) — https URL example
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.responses.create({
  model: "gpt-5",
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: "Read the small text in this UI and summarize the alert." },
      { type: "input_image", image_url: "https://example.com/ui.png", detail: "high" },
    ],
  }],
});

console.log(response.output_text);


Pattern mirrors the Python SDK and official reference. 
GitHub
+1

cURL (REST) — data URL
curl https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-5",
    "input":[
      {
        "role":"user",
        "content":[
          {"type":"input_text","text":"Extract the total amount from this receipt."},
          {"type":"input_image","image_url":"data:image/png;base64,REPLACE_WITH_BASE64","detail":"high"}
        ]
      }
    ]
  }'


REST uses the same input → content parts schema as the SDKs. 
OpenAI Platform

Practical tips (so the model truly “sees” it)

Crop to the task. If the relevant region is small, pre-crop the image (client-side) before sending; this reduces ambiguity and cost.

Use high for tiny text (tooltips, logs, financial terminals); use low for layout-only questions. 
GitHub
+1

Sequence matters. If you send multiple images, order them logically and reference them (“first image… second image…”) in your input_text. 
GitHub

Screenshots are supported. They’re a first-class image input—ideal for “what do you see / read this UI” prompts. 
OpenAI

Error hygiene. If you see “image not accessible,” your URL might require auth. Switch to a data URL or host the file on a publicly reachable URL with HTTPS. (The SDK README shows the working data-URL pattern.) 
GitHub

Realtime API (optional) — images in live sessions

If you’re building voice/vision agents, the Realtime API also accepts image inputs in-session (images/photos/screenshots), enabling “what do you see?” style interactions alongside audio/text. The transport is different (WebRTC/WebSocket), but the concept—send image parts—is the same. 
OpenAI
+1

Gotchas & notes

Which models accept images? GPT-5 in the API is multimodal; earlier multimodal families (e.g., 4o, 4.1) also accept text+image via the same content-parts scheme in the Responses API. Always check the current model card in the API docs when you deploy. 
OpenAI
+1

Streaming doesn’t change inputs. If you stream outputs, you still send image parts the same way; only the response transport changes. 
OpenAI Platform

File IDs. Historically, some routes/tools can reference uploaded files by file_id. For image understanding in Responses, the documented path is via image_url (https or data URL). If/when file_id is supported for image parts on your account, OpenAI will note it in the API reference. 
OpenAI Platform

References (key, official)

Responses API reference (supports text and image inputs; content parts incl. input_image.image_url). 
OpenAI Platform

Python SDK README — shows input_text/input_image with both web URLs and base64 data URLs, plus AsyncOpenAI. 
GitHub

Introducing GPT-5 for developers — model family overview. 
OpenAI

Realtime API overview — image inputs (including screenshots) in live sessions. 
OpenAI
+1

If you want, I can tailor a tiny async utility for your stack that: (1) pre-crops screenshots, (2) sets detail adaptively (low/high based on OCR confidence), (3) batches and parallelizes image calls to maximize your M3 Max throughput—just say the word and what runtime you prefer (pure asyncio, aiohttp, or Node).

ChatGPT can make mistakes. Check important info.
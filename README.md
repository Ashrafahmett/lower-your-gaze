# Modest Blur

Brave / Chrome extension that blurs images and videos showing women or revealing
content. Everything runs **locally**. No image ever leaves your computer.

## Install in Brave
1. Open `brave://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → choose this `modest-blur` folder
4. Pin it from the puzzle-piece menu so the popup is one click away

After changing any file, press the reload ↻ button on the extension card.

## How it works
- `blur.css` blurs every `<img>`, `<video>` and CSS background image from the first paint.
- `content.js` sends each one to `offscreen.html`, where `detector.js` runs two local AI models:
  - **face-api** (SSD MobileNet + age/gender): finds faces and guesses gender.
  - **NSFW MobileNetV2**: scores how revealing an image is.
- Only images judged safe are un-blurred. If anything fails, the image stays blurred.
- Videos are re-checked every second while playing and must pass two checks in a row.

## Settings (popup)
- **Strict** (default): blurs any face that *might* be a woman, plus mildly revealing images.
- **Normal**: blurs only faces the AI is fairly sure are women, plus clearly revealing images.
- **Blur every image**: no AI at all, everything stays blurred.
- **Videos**: check while playing, or always blur.
- **Turn off for this site**: allow-list for sites you trust.
- Right-click a blurred image → **Modest Blur: show this one** to show only that image.

## Limits
- The AI cannot tell whether hair is covered, so it blurs women whether or not they wear hijab.
- It is not perfect: some men and animals get blurred, and rarely a woman is missed
  (very small, side-on or hidden faces). For maximum safety use **Blur every image**.
- A video can show up to about 1 second of new content before the next check blurs it.

## Credits
face-api by Vladimir Mandic (MIT, `lib/LICENSE-face-api`), NSFW model from nsfwjs by Infinite Red (MIT).
# lower-your-gaze

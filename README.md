# मन के मोती

**प्रमिला सिंह की दोहा एवं काव्य रचनाओं का डिजिटल स्मृति-संग्रह।**

यह वेबसाइट सहेजी गई मूल रचनाओं को एक पुस्तक-जैसे अनुभव में प्रस्तुत करती है। मूल `.txt` फाइलें बिना बदले `content/notes/` में सुरक्षित हैं और उनसे खोजने योग्य संग्रह अपने-आप बनाया जाता है।

## स्थानीय रूप से खोलें

ब्राउज़र सुरक्षा नियमों के कारण JSON संग्रह को सीधे `index.html` पर डबल-क्लिक करके नहीं खोला जा सकता। रिपॉजिटरी की जड़ से एक छोटा वेब सर्वर चलाएँ:

```powershell
python -m http.server 8000
```

फिर [http://localhost:8000](http://localhost:8000) खोलें।

## नई रचना जोड़ें

1. UTF-8 `.txt` फाइल को `content/notes/` में रखें।
2. संग्रह दोबारा बनाएँ:

   ```powershell
   python scripts/build_collection.py
   ```

3. बदली हुई मूल फाइल और `data/poems.json`, `data/stats.json` व
   `data/editorial.json` को commit करें।

शीर्षक, तारीख, प्रदत्त शब्द और मूल रचना सुरक्षित अभिलेख के प्रारूप से स्वतः
पहचाने जाते हैं। पाठक के **अभिलेख** टैब में पूरा सुरक्षित मूल पाठ देखा जा सकता है।

## अनुवाद और संपादकीय प्रारूप

`data/editorial.json` में हर note ID के लिए मूल रचना से अलग संपादकीय record है।
इसमें Roman transliteration, उपलब्ध होने पर पढ़ने योग्य English draft, बच्चों के
लिए poem-specific English अर्थ, सरल हिंदी अर्थ, संदर्भ, साक्ष्य, confidence और
review status अलग-अलग रखे गए हैं। इसका schema `data/editorial.schema.json` में
है।

सभी मौजूदा records **draft** हैं। पढ़ने योग्य, रचना-विशिष्ट translation
`data/editorial_overrides.json` में रखी जाती है। जिस रचना का जिम्मेदारी से
अनुवाद अभी तैयार नहीं है, उसमें translation/explanation fields `null`,
`needs-human-translation` flag सक्रिय, और reader में संबंधित tabs छिपे रहते हैं।
टूटी हुई word-by-word या Romanized Hindi को English translation की तरह नहीं
दिखाया जाता। परिवार की समीक्षा होने तक `familyReviewed` हमेशा `false` रहेगा।

संग्रह बनाते समय `scripts/build_collection.py` अपने-आप
`scripts/build_editorial.py` भी चलाता है। Curated drafts override file से
दोबारा जुड़ते हैं, इसलिए regeneration उन्हें नहीं मिटाता। परिवार से स्वीकृत
records के लिए भविष्य में draft overrides से अलग reviewed dataset बनाना होगा।

## किसी पन्ने पर कला जोड़ें

1. चित्र को `art/` में रखें, जैसे `art/lotus.webp`।
2. `data/artwork.json` में रचना की मूल फाइल का नाम (बिना `.txt`) और चित्र का पथ जोड़ें:

   ```json
   {
     "notes_20240423114030": "art/lotus.webp"
   }
   ```

3. `python scripts/build_collection.py` फिर से चलाएँ।

चित्र उस रचना के खुले हुए पुस्तक-पन्ने पर दिखाई देगा। जिन रचनाओं के लिए अभी चित्र नहीं है, वहाँ जानबूझकर एक सुंदर placeholder रखा गया है।

## Gemini artwork CLI

The repository includes a review-first Playwright CLI for generating artwork efficiently without publishing unreviewed output.

Install dependencies without downloading Playwright's bundled browser—the CLI uses the locally installed Chrome:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install
```

Authenticate once using a dedicated profile outside the repository:

```powershell
npm run artwork:auth -- `
  --profile "C:\Users\super\.copilot\gemini-art-profile-forward"
```

Plan a queue without opening Gemini:

```powershell
npm run artwork:plan -- --start-page 135 --count 25
```

Generate into an isolated review checkpoint:

```powershell
npm run artwork:run -- `
  --profile "C:\Users\super\.copilot\gemini-art-profile-forward" `
  --session "forward-135" `
  --start-page 135 `
  --count 25 `
  --fresh-chat-every 25 `
  --reference "art\notes_20240423113656.jpg" `
  --reference "art\notes_20240423113808.jpg"
```

The runner hovers over the completed Gemini image and uses the visible download button. Downloads remain under ignored `.artwork-cli/` storage until reviewed:

```powershell
npm run artwork:review -- --session "forward-135" --open
npm run artwork:accept -- --session "forward-135" --all
```

`accept` copies only approved native downloads into `art/`, merges mappings, appends prompt provenance, rebuilds generated data, and runs validation.

### Parallel agents

Multiple agents can work independently by using:

- non-overlapping page ranges
- distinct `--session` names
- distinct persistent `--profile` directories

For example, one worker can move forward from page 135 while another moves backward from page 746:

```powershell
npm run artwork:run -- `
  --profile "C:\Users\super\.copilot\gemini-art-profile-reverse" `
  --session "reverse-746" `
  --direction reverse `
  --start-page 746 `
  --count 25
```

Each checkpoint remains isolated until explicitly accepted. Chrome profiles contain authenticated Google sessions and must never be committed, uploaded, or shared.

## मुख्य विशेषताएँ

- 750 अद्वितीय मूल रचनाओं का सुरक्षित, खोजने योग्य संग्रह
- शीर्षक, पंक्ति और मूल नोट में हिंदी खोज
- वर्ष के अनुसार फ़िल्टर
- textured दो-पृष्ठ पुस्तक reader, animated page turns और keyboard navigation
- browser में सुरक्षित किए जाने वाले प्रिय पन्ने
- हर रचना का shareable link और print layout
- मूल रचना को सामने रखते हुए scrollable Roman, English, सरल अर्थ, संदर्भ और
  अभिलेख tabs
- सभी 750 रचनाओं के अलग, schema-validated संपादकीय draft records
- हर पन्ने के लिए भविष्य की कलाकृति का स्थान
- responsive mobile और desktop design
- GitHub Pages पर स्वचालित deployment

## संग्रह दोबारा जाँचें

```powershell
python scripts/build_collection.py
python -m unittest discover -s tests
node --check app.js
git diff --check
```

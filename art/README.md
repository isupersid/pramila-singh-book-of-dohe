# रचनाओं की कला

इस folder में प्रत्येक दोहे या रचना से प्रेरित चित्र रखें। WebP या AVIF छोटे और तेज़ रहते हैं; PNG और JPEG भी काम करेंगे।

चित्र जोड़ने के बाद `data/artwork.json` में उसे संबंधित note ID से जोड़ें और `python scripts/build_collection.py` चलाएँ। Gemini से चित्र बनाते समय native 3:4 portrait ratio, high resolution और 8% safe margin माँगें। डाउनलोड किए गए चित्र के मूल dimensions और bytes सुरक्षित रखें; केवल note ID के अनुसार filename बदलें, crop, stretch या resize-to-fill न करें। पूरी प्रक्रिया मुख्य [README](../README.md) में दी गई है।

सभी चित्रों में एक समान दृश्य शैली बनाए रखने के लिए साझा base prompt और पहले batch के poem-specific prompts [`prompts.md`](prompts.md) में सुरक्षित हैं।

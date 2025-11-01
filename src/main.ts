import './style.css';
import { GM_xmlhttpRequest } from '$';

function parseParagraphs(doc: Document): string[] {
  let paraNodes: HTMLParagraphElement[] = [];
  const articleElem = doc.querySelector('article');
  if (articleElem) paraNodes = Array.from(articleElem.querySelectorAll('p')) as HTMLParagraphElement[];
  if (paraNodes.length === 0) paraNodes = Array.from(doc.querySelectorAll('p')) as HTMLParagraphElement[];
  const texts: string[] = [];
  paraNodes.forEach((p) => {
    const text = (p.textContent ?? '').trim();
    if (text) texts.push(text);
  });
  return texts;
}

function parseImages(doc: Document): string[] {
  const images: string[] = [];
  let imgs: HTMLImageElement[] = [];
  const articleElem = doc.querySelector('article');
  if (articleElem) imgs = Array.from(articleElem.querySelectorAll('img')) as HTMLImageElement[];
  else imgs = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
  const base = doc.baseURI || window.location.href;
  imgs.forEach((img) => {
    let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!src) return;
    const lowerSrc = src.toLowerCase();
    if (lowerSrc.includes('clear.gif') || lowerSrc.includes('boost_') || lowerSrc.includes('icon') || lowerSrc.startsWith('data:')) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if ((w && w < 50) || (h && h < 50)) return;
    try {
      const urlObj = new URL(src, base);
      src = urlObj.href;
    } catch { }
    images.push(src);
  });
  return images;
}

function splitSentences(text: string): string[] {
  const delim = /[。！？.!?]/;
  const sentences: string[] = [];
  let current = '';
  for (const ch of text) {
    current += ch;
    if (delim.test(ch)) {
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }
  const trimmed = current.trim();
  if (trimmed) sentences.push(trimmed);
  return sentences;
}

function fetchPage(url: string): Promise<{ doc: Document; paragraphs: string[]; images: string[] }> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { 'User-Agent': navigator.userAgent, Referer: window.location.href },
      onload: (response: { responseText: string }) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.responseText, 'text/html');
        const paragraphs = parseParagraphs(doc);
        const images = parseImages(doc);
        resolve({ doc, paragraphs, images });
      },
      onerror: () => reject(new Error('Failed to fetch')),
    });
  });
}

function buildCard(title: string): { root: HTMLDivElement; content: HTMLDivElement; images: HTMLDivElement; toggleBtn: HTMLButtonElement } {
  const card = document.createElement('div');
  card.className = 'tm-card';

  const header = document.createElement('div');
  header.className = 'tm-card__header';

  const hTitle = document.createElement('div');
  hTitle.className = 'tm-card__title';
  hTitle.textContent = title;

  const actions = document.createElement('div');
  actions.className = 'tm-card__actions';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'tm-btn';
  toggleBtn.textContent = '折叠';
  actions.appendChild(toggleBtn);

  header.appendChild(hTitle);
  header.appendChild(actions);

  const content = document.createElement('div');
  content.className = 'tm-card__content';
  content.textContent = '記事を読み込み中...';

  const images = document.createElement('div');
  images.className = 'tm-card__images';

  card.appendChild(header);
  card.appendChild(content);
  card.appendChild(images);

  toggleBtn.addEventListener('click', () => {
    const hidden = content.style.display === 'none';
    content.style.display = hidden ? '' : 'none';
    images.style.display = hidden ? '' : 'none';
    toggleBtn.textContent = hidden ? '折叠' : '展开';
  });

  return { root: card, content, images, toggleBtn };
}

(() => {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('p') ?? '';
  if (!query) return;
  const lowerQuery = query.toLowerCase();

  const articleAnchors = Array.from(document.querySelectorAll('a[href*="/articles/"]')) as HTMLAnchorElement[];
  const articleLinks = articleAnchors.filter((link, index, array) => array.findIndex((l) => l.href === link.href) === index);
  if (articleLinks.length === 0) return;

  articleLinks.forEach((link) => {
    const title = link.textContent?.trim() || link.href;
    const { root, content, images } = buildCard(title);
    link.parentElement?.appendChild(root);

    (async () => {
      try {
        const urlObj = new URL(link.href, window.location.href);
        const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
        const firstPage = await fetchPage(link.href);
        let allParagraphs = firstPage.paragraphs.slice();
        let allImages = firstPage.images.slice();

        let maxPage = 1;
        const pageNumbers = new Set<number>();
        const anchors = Array.from(firstPage.doc.querySelectorAll('a[href*="?page="]')) as HTMLAnchorElement[];
        anchors.forEach((a) => {
          const match = a.href.match(/\?page=(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!Number.isNaN(num)) pageNumbers.add(num);
          }
        });
        if (pageNumbers.size > 0) maxPage = Math.max(...Array.from(pageNumbers));
        if (maxPage > 1) {
          for (let i = 2; i <= maxPage; i += 1) {
            const pageUrl = `${baseUrl}?page=${i}`;
            try {
              const res = await fetchPage(pageUrl);
              allParagraphs = allParagraphs.concat(res.paragraphs);
              allImages = allImages.concat(res.images);
            } catch { }
          }
        }
        allImages = Array.from(new Set(allImages));

        const frag = document.createDocumentFragment();
        const orderedSentences: string[] = [];
        allParagraphs.forEach((paragraph) => {
          const sentences = splitSentences(paragraph);
          sentences.forEach((s) => orderedSentences.push(s));
        });
        orderedSentences.forEach((sentence) => {
          const pNode = document.createElement('p');
          const lowerText = sentence.toLowerCase();
          if (lowerText.includes(lowerQuery)) {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const reg = new RegExp(escaped, 'gi');
            pNode.innerHTML = sentence.replace(reg, (m) => `<span class="tm-highlight">${m}</span>`);
          } else {
            pNode.textContent = sentence;
          }
          frag.appendChild(pNode);
        });
        content.innerHTML = '';
        content.appendChild(frag);

        images.innerHTML = '';
        if (allImages.length > 0) {
          const grid = document.createElement('div');
          grid.className = 'tm-image-grid';
          allImages.forEach((src) => {
            const a = document.createElement('a');
            a.href = src;
            a.target = '_blank';
            const img = document.createElement('img');
            img.src = src;
            img.loading = 'lazy';
            img.className = 'tm-thumb';
            a.appendChild(img);
            grid.appendChild(a);
          });
          images.appendChild(grid);
        } else {
          const noImg = document.createElement('p');
          noImg.textContent = 'この記事には画像が含まれていません。';
          images.appendChild(noImg);
        }
      } catch {
        content.textContent = '記事の読み込みに失敗しました。';
      }
    })();
  });
})();

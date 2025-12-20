import './style.css';
import { GM_xmlhttpRequest } from '$';

const MIN_IMAGE_SIZE = 50;

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
    if ((w && w < MIN_IMAGE_SIZE) || (h && h < MIN_IMAGE_SIZE)) return;
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

function buildCard(title: string): {
  root: HTMLDivElement;
  content: HTMLDivElement;
  images: HTMLDivElement;
  toggleBtn: HTMLButtonElement;
} {
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
  toggleBtn.textContent = '折りたたむ';

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
    toggleBtn.textContent = hidden ? '折りたたむ' : '展開する';
  });

  return { root: card, content, images, toggleBtn };
}

// Load state management
const LOAD_STATE = {
  PENDING: 'pending',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
} as const;

async function loadArticleContent(
  card: HTMLElement,
  link: HTMLAnchorElement,
  content: HTMLDivElement,
  images: HTMLDivElement,
  lowerQuery: string,
  query: string
): Promise<void> {
  card.dataset.loadState = LOAD_STATE.LOADING;

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
        } catch {}
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

    card.dataset.loadState = LOAD_STATE.LOADED;
  } catch {
    content.textContent = '記事の読み込みに失敗しました。';
    card.dataset.loadState = LOAD_STATE.ERROR;
  }
}

(() => {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('p') ?? '';
  if (!query) return;
  const lowerQuery = query.toLowerCase();

  // 只选取主要搜索结果区域的文章链接，排除侧边栏(#yjnSub)中的链接
  const articleAnchors = Array.from(document.querySelectorAll('#yjnMain a[href*="/articles/"]')) as HTMLAnchorElement[];
  const articleLinks = articleAnchors.filter((link, index, array) => array.findIndex((l) => l.href === link.href) === index);
  if (articleLinks.length === 0) return;

  // IntersectionObserver for lazy loading - load when card enters viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target as HTMLElement;
          if (card.dataset.loadState === LOAD_STATE.PENDING) {
            const link = card.dataset.href ? document.querySelector(`a[href="${card.dataset.href}"]`) as HTMLAnchorElement : null;
            const content = card.querySelector('.tm-card__content') as HTMLDivElement;
            const images = card.querySelector('.tm-card__images') as HTMLDivElement;
            if (link && content && images) {
              loadArticleContent(card, link, content, images, lowerQuery, query);
            }
          }
        }
      });
    },
    { rootMargin: '100px' } // Pre-load 100px before entering viewport
  );

  articleLinks.forEach((link) => {
    const title = link.textContent?.trim() || link.href;
    const { root } = buildCard(title);
    
    // Store link href for later retrieval and set initial state
    root.dataset.href = link.href;
    root.dataset.loadState = LOAD_STATE.PENDING;
    
    link.parentElement?.appendChild(root);
    
    // Start observing - will load when card enters viewport
    observer.observe(root);
  });

  // Global keyboard navigation for all highlights
  let globalHighlightIndex = -1;

  const navigateGlobal = (direction: 'prev' | 'next') => {
    const allHighlights = Array.from(document.querySelectorAll('.tm-highlight')) as HTMLElement[];
    if (allHighlights.length === 0) return;

    // Remove previous active state from all
    allHighlights.forEach((el) => el.classList.remove('tm-highlight--active'));

    if (direction === 'prev') {
      globalHighlightIndex = globalHighlightIndex <= 0 ? allHighlights.length - 1 : globalHighlightIndex - 1;
    } else {
      globalHighlightIndex = globalHighlightIndex >= allHighlights.length - 1 ? 0 : globalHighlightIndex + 1;
    }

    const target = allHighlights[globalHighlightIndex];
    target.classList.add('tm-highlight--active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in an input field
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateGlobal('prev');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      navigateGlobal('next');
    }
  });
})();

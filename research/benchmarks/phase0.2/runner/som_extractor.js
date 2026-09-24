/**
 * Research Prototype: Semantic Object Model (SOM) Extractor
 * Benchmark Phase 0.2
 *
 * Traverses DOM tree, prunes presentational noise, extracts semantic affordances,
 * and explicitly enforces security boundaries (redacting password inputs).
 */
function extractSOM(root = document.body) {
  const startTime = performance.now();
  let elementCounter = 0;

  function isElementVisible(elem) {
    if (!elem || elem.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(elem);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (elem.getAttribute('aria-hidden') === 'true') return false;
    
    const rect = elem.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && elem.children.length === 0) {
      return false;
    }
    return true;
  }

  function getAccessibleName(elem) {
    if (!elem) return '';
    if (elem.hasAttribute('aria-label')) {
      return elem.getAttribute('aria-label').trim();
    }
    if (elem.hasAttribute('aria-labelledby')) {
      const id = elem.getAttribute('aria-labelledby');
      const labelElem = document.getElementById(id);
      if (labelElem) return labelElem.innerText.trim();
    }
    if (elem.id) {
      const label = document.querySelector(`label[for="${elem.id}"]`);
      if (label) return label.innerText.trim();
    }
    if (elem.hasAttribute('placeholder')) {
      return elem.getAttribute('placeholder').trim();
    }
    if (elem.hasAttribute('alt')) {
      return elem.getAttribute('alt').trim();
    }
    if (elem.hasAttribute('title')) {
      return elem.getAttribute('title').trim();
    }
    return '';
  }

  function determineSemanticRole(elem) {
    const tag = elem.tagName.toLowerCase();
    const explicitRole = elem.getAttribute('role');
    if (explicitRole) return explicitRole;

    switch (tag) {
      case 'a': return elem.hasAttribute('href') ? 'link' : 'generic';
      case 'button': return 'button';
      case 'input': {
        const type = (elem.getAttribute('type') || 'text').toLowerCase();
        if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'password') return 'password_input';
        return 'text_input';
      }
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'article': return 'article';
      case 'aside': return 'complementary';
      case 'header': return 'banner';
      case 'footer': return 'contentinfo';
      case 'table': return 'table';
      case 'tr': return 'row';
      case 'th': case 'td': return 'cell';
      case 'form': return 'form';
      case 'iframe': return 'iframe';
      case 'img': return 'image';
      case 'ul': case 'ol': return 'list';
      case 'li': return 'listitem';
      default: return 'generic';
    }
  }

  function isInteractive(role, elem) {
    const interactiveRoles = [
      'button', 'link', 'text_input', 'password_input',
      'checkbox', 'radio', 'combobox', 'textbox'
    ];
    if (interactiveRoles.includes(role)) return true;
    if (elem.hasAttribute('onclick') || elem.getAttribute('tabindex') === '0') return true;
    return false;
  }

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      return text.length > 0 ? { type: 'text', content: text } : null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const elem = node;
    const tag = elem.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'svg', 'meta', 'link'].includes(tag)) {
      return null;
    }

    const visible = isElementVisible(elem);
    const role = determineSemanticRole(elem);
    const interactive = isInteractive(role, elem);
    const accName = getAccessibleName(elem);

    // SECURITY VERIFICATION: Masked password & sensitive input handling
    const isPassword = role === 'password_input' || elem.getAttribute('type') === 'password';
    const isSensitive = isPassword || elem.getAttribute('autocomplete') === 'cc-number' || elem.id === 'cc-cvv';

    let frameOrigin = null;
    let isCrossOrigin = false;
    if (tag === 'iframe') {
      try {
        const src = elem.getAttribute('src') || '';
        frameOrigin = src.startsWith('http') ? new URL(src).origin : window.location.origin;
        isCrossOrigin = frameOrigin !== window.location.origin;
      } catch (e) {
        isCrossOrigin = true;
      }
    }

    // Process children recursively
    const children = [];
    for (const child of elem.childNodes) {
      const processedChild = processNode(child);
      if (processedChild) {
        if (Array.isArray(processedChild)) {
          children.push(...processedChild);
        } else {
          children.push(processedChild);
        }
      }
    }

    // Presentational noise pruning heuristic:
    if (role === 'generic' && !interactive && !accName && !elem.id) {
      if (children.length === 1) return children[0];
      if (children.length > 1) return children;
      return null;
    }

    elementCounter++;
    const somNode = {
      somId: `som-${elementCounter}`,
      role: role,
      tag: tag
    };

    if (accName) somNode.name = accName;
    if (interactive) somNode.interactive = true;
    if (!visible) somNode.isHidden = true;

    // Security constraints
    if (isPassword) {
      somNode.isPassword = true;
      somNode.value = '[REDACTED]';
    } else if (isSensitive) {
      somNode.isSensitive = true;
      somNode.value = '[REDACTED]';
    } else if (['input', 'textarea', 'select'].includes(tag) && elem.value) {
      somNode.value = elem.value;
    }

    if (tag === 'a' && elem.hasAttribute('href')) {
      somNode.href = elem.getAttribute('href');
    }

    if (tag === 'iframe') {
      somNode.frameOrigin = frameOrigin;
      somNode.isCrossOrigin = isCrossOrigin;
    }

    if (children.length > 0) {
      if (children.length === 1 && children[0].type === 'text') {
        somNode.text = children[0].content;
      } else {
        somNode.children = children.filter(c => c !== null);
      }
    }

    return somNode;
  }

  const tree = processNode(root);
  const extractionTimeMs = performance.now() - startTime;

  return {
    url: window.location.href,
    title: document.title,
    nodeCount: elementCounter,
    extractionTimeMs: parseFloat(extractionTimeMs.toFixed(3)),
    somTree: tree
  };
}

JSON.stringify(extractSOM());


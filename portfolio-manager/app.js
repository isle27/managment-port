const byId = id => document.getElementById(id);
const form = byId('project-form');
const editor = byId('editor');
const removal = byId('remove');
const list = byId('list');
const textFields = ['title', 'description', 'github', 'live', 'ai_category', 'ai_overview'];
const flags = ['published', 'featured', 'show_on_se', 'show_on_ai'];
let projects = [];
let connected = false;
let reordering = false;
let editing;
let deleting;
let busy = false;
let cover = '';
let coverRevision = 0;
let processingCover = false;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

async function api(path = '', method = 'GET', data) {
  const response = await fetch('/api/projects' + path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && result.signIn === true) location.assign('/login');
    throw new Error(result.error);
  }
  return result;
}

function action(label, title, callback, disabled = false, className = '') {
  const button = element('button', className, label);
  button.type = 'button';
  button.setAttribute('aria-label', title);
  button.disabled = disabled || busy;
  button.addEventListener('click', callback);
  return button;
}

function imageSource(value, project) {
  if (/^(https:\/\/|data:image\/(?:webp|jpeg|png);base64,)/i.test(value)) return value;
  if (/^\/(?![\\/])/.test(value)) {
    return new URL(value, project?.show_on_ai && !project.show_on_se
      ? 'https://elsiai.chanyalew.com' : 'https://elsadev.chanyalew.com').href;
  }
  return '';
}

function showCover(value, project) {
  const preview = byId('cover-preview');
  const image = preview.querySelector('img');
  const url = imageSource(value, project);
  preview.hidden = !url;
  if (!url) image.removeAttribute('src');
  else image.src = url;
}

function card(project) {
  const item = element('li', 'project-card');
  const media = element('div', 'project-media');
  const fallback = element('span', 'media-fallback', 'No cover image');
  media.append(fallback);
  const src = imageSource(project.image, project);
  if (src) {
    const image = element('img');
    image.alt = project.title + ' cover';
    image.decoding = 'async';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    image.src = src;
    media.append(image);
  }
  const body = element('div', 'project-body');
  const targets = [project.show_on_ai && 'AI Engineering', project.show_on_se && 'Software Engineering'].filter(Boolean);
  body.append(element('p', 'destinations', targets.join(' · ') || 'No portfolio assigned'));
  body.append(element('h3', '', project.title));
  if (project.description) body.append(element('p', 'description', project.description));

  const controls = element('div', 'card-actions');
  const publication = project.published ? 'Unpublish' : 'Publish';
  controls.append(
    action('Edit project', 'Edit ' + project.title, () => openEditor(project)),
    action(publication, publication + ' ' + project.title, () => {
      if (!project.published && !project.show_on_se && !project.show_on_ai) return openEditor(project);
      return change(() => save({ ...project, published: !project.published }, project.id),
        project.published ? 'Project unpublished.' : 'Project published.');
    }, false, 'publish-action')
  );
  item.append(media, body, controls);
  return item;
}

function section(title, records, emptyMessage) {
  const group = element('section', 'project-section');
  const heading = element('div', 'section-heading');
  heading.append(element('h2', '', title), element('span', 'count', records.length));
  group.append(heading);
  if (records.length) {
    const cards = element('ul', 'project-grid');
    for (const record of records) cards.append(card(record));
    group.append(cards);
  } else {
    group.append(element('p', 'empty', emptyMessage));
  }
  return group;
}

function render() {
  const search = byId('search');
  const portfolio = byId('portfolio-filter');
  const status = byId('status-filter');
  const orderButton = byId('reorder');
  byId('add').disabled = busy || !connected;
  search.disabled = portfolio.disabled = status.disabled = reordering || !connected;
  orderButton.disabled = busy || !connected || (!reordering && projects.length < 2);
  orderButton.textContent = reordering ? 'Done reordering' : 'Reorder';
  orderButton.setAttribute('aria-pressed', String(reordering));
  byId('order-help').hidden = !reordering;
  const query = search.value.trim().toLowerCase();
  const visible = projects.filter(project =>
    (portfolio.value === 'all' || project[portfolio.value]) &&
    [project.title, project.description, ...project.technologies].some(value => value.toLowerCase().includes(query)));
  list.replaceChildren();
  if (reordering) {
    const order = element('ol', 'order-list');
    for (const [index, project] of projects.entries()) {
      const item = element('li');
      const controls = element('div', 'order-controls');
      controls.append(
        action('Move up', 'Move ' + project.title + ' up', () => move(project, -1), index === 0),
        action('Move down', 'Move ' + project.title + ' down', () => move(project, 1), index === projects.length - 1)
      );
      item.append(element('span', 'position', index + 1), element('strong', '', project.title), controls);
      order.append(item);
    }
    list.append(order);
    return;
  }
  if (status.value !== 'draft') {
    list.append(section('Published', visible.filter(project => project.published), 'No published projects match this view.'));
  }
  if (status.value !== 'published') {
    list.append(section('Drafts', visible.filter(project => !project.published), 'No drafts match this view.'));
  }
}

async function save(data, id) {
  const project = await api(id ? '/' + id : '', id ? 'PATCH' : 'POST',
    { ...data, github: data.github || '', live: data.live || '' });
  projects = id ? projects.map(item => item.id === id ? project : item) : [...projects, project];
}

async function change(operation, message, errorNode) {
  if (busy) return false;
  busy = true;
  const target = errorNode || byId('status');
  const focused = document.activeElement?.getAttribute('aria-label');
  target.textContent = '';
  render();
  const submit = errorNode?.closest('form').querySelector('[type=submit]');
  if (submit) submit.disabled = true;
  try {
    await operation();
    byId('status').textContent = message;
    return true;
  } catch (error) {
    target.textContent = error.message;
    return false;
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
    render();
    if (focused && !errorNode) {
      const next = [...list.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === focused);
      if (next && !next.disabled) next.focus();
    }
  }
}

function move(project, direction) {
  return change(async () => {
    await api('/' + project.id + '/move', 'POST', { direction });
    projects = (await api()).projects;
  }, 'Project order updated.');
}

function openEditor(project) {
  editing = project?.id;
  form.reset();
  coverRevision++;
  processingCover = false;
  form.querySelector('[type=submit]').disabled = false;
  cover = project?.image || '';
  byId('cover-error').textContent = '';
  byId('cover-url').value = cover.startsWith('data:') ? '' : cover;
  showCover(cover, project);
  byId('form-error').textContent = '';
  byId('editor-title').textContent = editing ? 'Edit project' : 'New project';
  for (const key of textFields) form.elements[key].value = project?.[key] || '';
  form.elements.technologies.value = project?.technologies.join(', ') || '';
  form.elements.ai_outcomes.value = project?.ai_outcomes.join('\n') || '';
  for (const key of flags) form.elements[key].checked = project?.[key] ?? false;
  byId('ai-fields').open = false;
  byId('delete-project').hidden = !project;
  editor.showModal();
}

async function prepareCover(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG, or WebP image up to 15 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.82, .68, .5]) {
      const result = canvas.toDataURL('image/webp', quality);
      if (result.length <= 700000) return result;
    }
    throw new Error('This image is too large after resizing. Choose a smaller image.');
  } finally {
    bitmap.close();
  }
}

byId('cover-file').addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  const revision = ++coverRevision;
  const submit = form.querySelector('[type=submit]');
  processingCover = true;
  submit.disabled = true;
  byId('cover-error').textContent = '';
  try {
    const prepared = await prepareCover(file);
    if (revision !== coverRevision) return;
    cover = prepared;
    byId('cover-url').value = '';
    showCover(cover);
  } catch (error) {
    if (revision !== coverRevision) return;
    byId('cover-error').textContent = error instanceof DOMException ? 'This file could not be read as an image.' : error.message;
    event.target.value = '';
  } finally {
    if (revision === coverRevision) {
      processingCover = false;
      submit.disabled = false;
    }
  }
});

function openRemoval(project) {
  deleting = project.id;
  byId('remove-error').textContent = '';
  byId('remove-copy').textContent = '“' + project.title + '” will be permanently deleted.';
  removal.showModal();
}

byId('cover-url').addEventListener('input', () => {
  const value = byId('cover-url').value.trim();
  showCover(value || cover, projects.find(project => project.id === editing));
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (processingCover) return;
  const data = Object.fromEntries(new FormData(form));
  for (const key of textFields) data[key] = data[key].trim();
  for (const key of flags) data[key] = form.elements[key].checked;
  const entered = byId('cover-url').value.trim();
  data.image = entered || cover;
  data.technologies = [...new Set(data.technologies.split(',').map(tag => tag.trim()).filter(Boolean))];
  data.ai_outcomes = data.ai_outcomes.split('\n').map(outcome => outcome.trim()).filter(Boolean);
  const errorNode = byId('form-error');
  if (!data.title) {
    errorNode.textContent = 'Enter a project name.';
    return;
  }
  if ((!editing && !data.image) || (entered && !imageSource(entered))) {
    errorNode.textContent = 'Upload a cover image or enter a valid HTTPS image URL.';
    return;
  }
  if (data.published && !data.show_on_se && !data.show_on_ai) {
    errorNode.textContent = 'Select at least one portfolio before publishing.';
    return;
  }
  if (await change(() => save(data, editing), 'Project saved to Neon.', errorNode)) editor.close();
});

byId('remove-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (await change(async () => {
    await api('/' + deleting, 'DELETE');
    projects = projects.filter(project => project.id !== deleting);
  }, 'Project deleted.', byId('remove-error'))) removal.close();
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => { if (!busy) byId(button.dataset.close).close(); });
}
for (const dialog of [editor, removal]) {
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
}
byId('add').addEventListener('click', () => openEditor());
byId('delete-project').addEventListener('click', () => {
  const project = projects.find(item => item.id === editing);
  if (!project || busy) return;
  editor.close();
  openRemoval(project);
});
byId('search').addEventListener('input', render);
byId('portfolio-filter').addEventListener('change', render);
byId('status-filter').addEventListener('change', render);
byId('reorder').addEventListener('click', () => {
  reordering = !reordering;
  render();
});

async function load() {
  try {
    projects = (await api()).projects;
    connected = true;
    byId('connection').textContent = 'Connected to Neon';
    render();
    list.classList.add('loaded');
  } catch (error) {
    byId('connection').textContent = 'Neon connection unavailable';
    for (const id of ['search', 'portfolio-filter', 'status-filter']) byId(id).disabled = true;
    list.replaceChildren(element('p', 'empty', error.message));
  }
}
load();

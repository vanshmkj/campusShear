(() => {
  const state = { user: null, csrfToken: '', resources: [], editingResource: null };
  const byId = (id) => document.getElementById(id);
  const accountMessage = byId('accountMessage');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showMessage(message, type = 'info') {
    accountMessage.textContent = message;
    accountMessage.className = `notice ${type}`;
    accountMessage.hidden = false;
  }

  async function refreshCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'same-origin' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to start a secure session.');
    state.csrfToken = payload.csrfToken;
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) {
      if (!state.csrfToken) await refreshCsrf();
      headers.set('X-CSRF-Token', state.csrfToken);
    }
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
    return payload;
  }

  function setFormTab(showRegister) {
    byId('loginForm').hidden = showRegister;
    byId('registerForm').hidden = !showRegister;
    byId('loginTab').classList.toggle('active', !showRegister);
    byId('registerTab').classList.toggle('active', showRegister);
    byId('loginTab').setAttribute('aria-selected', String(!showRegister));
    byId('registerTab').setAttribute('aria-selected', String(showRegister));
    accountMessage.hidden = true;
  }

  function categoryGlyph(category) {
    return ({ Books: '▤', Electronics: '⌁', 'Lab equipment': '⌬', Sports: '◉', Other: '✳' })[category] || '✳';
  }

  function renderResources(resources) {
    state.resources = resources;
    const grid = byId('resourceGrid');
    grid.replaceChildren();
    byId('resourceCount').textContent = `${resources.length} ${resources.length === 1 ? 'resource' : 'resources'}`;
    byId('emptyResources').hidden = resources.length > 0;
    for (const resource of resources) {
      const card = element('article', 'resource-card');
      const top = element('div', 'card-top');
      top.append(element('span', 'category-tag', resource.category));
      top.append(element('span', 'card-glyph', categoryGlyph(resource.category)));
      card.append(top);
      card.append(element('h3', '', resource.title));
      const description = element('p', '', resource.description);
      card.append(description);
      const footer = element('div', 'card-footer');
      footer.append(element('span', 'owner-name', `Shared by ${resource.owner_name}`));
      const details = element('button', 'text-button', 'View details ↗');
      details.type = 'button';
      details.addEventListener('click', () => openResourceDetails(resource.id));
      footer.append(details);
      card.append(footer);
      grid.append(card);
    }
  }

  async function loadResources() {
    const query = new URLSearchParams();
    const search = byId('resourceSearch').value.trim();
    const category = byId('categoryFilter').value;
    if (search) query.set('search', search);
    if (category) query.set('category', category);
    try {
      const result = await request(`/api/resources?${query}`);
      renderResources(result.resources);
    } catch (error) {
      byId('resourceGrid').replaceChildren(element('p', 'empty-inline', error.message));
      byId('emptyResources').hidden = true;
      byId('resourceCount').textContent = '';
    }
  }

  async function openResourceDetails(id) {
    try {
      const { resource } = await request(`/api/resources/${id}`);
      const dialog = byId('resourceDialog');
      const body = byId('resourceDetails');
      body.replaceChildren();
      body.append(element('span', 'category-tag', resource.category));
      body.append(element('h2', '', resource.title));
      body.append(element('p', 'detail-description', resource.description));
      body.append(element('p', 'owner-name', `Shared by ${resource.owner_name}`));
      const borrow = element('button', 'button button-dark', 'Request to borrow →');
      borrow.type = 'button';
      if (state.user?.approvalStatus !== 'approved' && state.user?.role !== 'admin') {
        borrow.textContent = state.user ? 'Account approval required' : 'Log in to request';
        borrow.disabled = Boolean(state.user);
      } else if (state.user?.role === 'admin') {
        borrow.textContent = 'Student account required';
        borrow.disabled = true;
      }
      borrow.addEventListener('click', async () => {
        if (!state.user) {
          dialog.close();
          setFormTab(false);
          document.querySelector('#account').scrollIntoView({ behavior: 'smooth' });
          showMessage('Log in with an approved student account to request this resource.');
          return;
        }
        try {
          const result = await request(`/api/resources/${id}/requests`, {
            method: 'POST',
            body: JSON.stringify({ message: '' })
          });
          dialog.close();
          showMessage(result.message, 'success');
          await refreshDashboard();
        } catch (error) {
          showMessage(error.message, 'error');
          dialog.close();
          document.querySelector('#account').scrollIntoView({ behavior: 'smooth' });
        }
      });
      body.append(borrow);
      dialog.showModal();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  function statusPill(status) {
    const pill = element('span', `status-pill pill-${status}`, status.replace('_', ' '));
    return pill;
  }

  function resetAccountPanels() {
    byId('accountForms').hidden = false;
    byId('studentStatus').hidden = true;
    byId('studentDashboard').hidden = true;
    byId('adminDashboard').hidden = true;
  }

  async function renderAccount(user) {
    state.user = user;
    const navAuth = document.querySelector('.nav-auth');
    const navRegister = document.querySelector('.nav-register');
    const forms = byId('accountForms');
    const status = byId('studentStatus');
    const studentDashboard = byId('studentDashboard');
    const adminDashboard = byId('adminDashboard');
    forms.hidden = Boolean(user);
    status.hidden = true;
    studentDashboard.hidden = true;
    adminDashboard.hidden = true;
    accountMessage.hidden = true;
    navAuth.textContent = user ? 'Your account' : 'Log in';
    navRegister.textContent = user ? 'Log out' : 'Join CampusShare';
    navRegister.onclick = user ? logout : null;
    navRegister.removeAttribute('data-open-register');
    if (!user) {
      navRegister.setAttribute('data-open-register', '');
      navAuth.onclick = null;
      return;
    }
    navAuth.onclick = (event) => {
      event.preventDefault();
      document.querySelector('#account').scrollIntoView({ behavior: 'smooth' });
    };
    if (user.role === 'admin') {
      adminDashboard.hidden = false;
      await renderAdminDashboard();
    } else if (user.approvalStatus === 'approved') {
      studentDashboard.hidden = false;
      await renderStudentDashboard();
    } else {
      status.hidden = false;
      renderStudentStatus(user);
    }
  }

  function renderStudentStatus(user) {
    const panel = byId('studentStatus');
    panel.replaceChildren();
    const card = element('div', 'status-card');
    const heading = element('div', 'dashboard-head');
    const title = element('div');
    title.append(element('p', 'eyebrow', 'YOUR CAMPUSSHARE ACCOUNT'));
    title.append(element('h3', '', `Hi, ${user.fullName.split(' ')[0]}`));
    heading.append(title, statusPill(user.approvalStatus));
    card.append(heading);
    card.append(element('p', '', user.approvalStatus === 'pending'
      ? 'Your registration is in the review queue. You can sign in to check your status, but sharing and borrowing will unlock after approval.'
      : 'Your registration was not approved. Please contact your campus administrator if you have questions.'));
    const details = element('div', 'status-details');
    for (const [label, value] of [['Student ID', user.studentId], ['Batch', user.batchYear], ['Card check', user.cardCheckStatus.replace('_', ' ')]]) {
      const item = element('div', 'status-detail');
      item.append(element('span', '', label), element('strong', '', String(value)));
      details.append(item);
    }
    card.append(details);
    if (user.cardCheckResult) {
      const result = typeof user.cardCheckResult === 'string' ? safeParse(user.cardCheckResult) : user.cardCheckResult;
      if (result) {
        const checks = element('ul', 'check-list');
        checks.append(
          element('li', '', `Printed student ID ${result.printedIdMatched ? 'matched' : 'needs review'}`),
          element('li', '', `QR student ID ${result.qrIdMatched ? 'matched' : 'needs review'}`),
          element('li', '', `College name ${result.collegeNameMatched ? 'found' : 'not found'}`)
        );
        card.append(checks);
      }
    }
    const logout = element('button', 'text-button', 'Log out');
    logout.type = 'button';
    logout.addEventListener('click', logout);
    card.append(logout);
    panel.append(card);
  }

  function safeParse(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  async function renderStudentDashboard() {
    const panel = byId('studentDashboard');
    panel.replaceChildren();
    const header = element('div', 'dashboard-head');
    const heading = element('div');
    heading.append(element('p', 'eyebrow', 'YOUR SHARING SPACE'), element('h3', '', `Welcome, ${state.user.fullName.split(' ')[0]}`));
    const signOut = element('button', 'small-button', 'Log out');
    signOut.type = 'button';
    signOut.addEventListener('click', logout);
    header.append(heading, signOut);
    panel.append(header, element('p', 'dashboard-subtitle', 'Share something useful, or keep track of the things you’ve requested.'));

    const listingSection = element('section', 'dashboard-section');
    listingSection.append(element('h4', '', 'List a resource'));
    const form = element('form', 'dashboard-form');
    appendLabel(form, 'Resource title', 'title', 'text', 'e.g. Intro to Biology textbook', true, 160);
    const description = element('label', '', 'Description');
    const textarea = element('textarea');
    textarea.name = 'description';
    textarea.required = true;
    textarea.maxLength = 5000;
    textarea.rows = 3;
    textarea.placeholder = 'Add a few helpful details';
    description.append(textarea);
    form.append(description);
    form.append(selectLabel('Category', 'category', ['Books', 'Electronics', 'Lab equipment', 'Sports', 'Other']));
    const submit = element('button', 'button button-dark', 'Publish listing →');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', createResource);
    listingSection.append(form);
    panel.append(listingSection);

    const owned = element('section', 'dashboard-section');
    owned.append(element('h4', '', 'Your listings'));
    const ownedList = element('div', 'dashboard-list');
    ownedList.id = 'ownedResources';
    owned.append(ownedList);
    panel.append(owned);
    const requests = element('section', 'dashboard-section');
    requests.append(element('h4', '', 'Borrowing requests'));
    const requestList = element('div', 'dashboard-list');
    requestList.id = 'borrowRequests';
    requests.append(requestList);
    panel.append(requests);
    await refreshDashboard();
  }

  function appendLabel(parent, labelText, name, type, placeholder, required, maxLength) {
    const label = element('label', '', labelText);
    const input = element('input');
    input.name = name;
    input.type = type;
    input.placeholder = placeholder;
    input.required = required;
    if (maxLength) input.maxLength = maxLength;
    label.append(input);
    parent.append(label);
  }

  function selectLabel(labelText, name, values) {
    const label = element('label', '', labelText);
    const select = element('select');
    select.name = name;
    for (const value of values) {
      const option = element('option', '', value);
      option.value = value;
      select.append(option);
    }
    label.append(select);
    return label;
  }

  async function createResource(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await request('/api/resources', { method: 'POST', body: JSON.stringify(data) });
      showMessage(result.message, 'success');
      form.reset();
      await Promise.all([loadResources(), refreshDashboard()]);
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  async function refreshDashboard() {
    if (!state.user || state.user.role === 'admin') return;
    try {
      const [ownedResult, requestResult] = await Promise.all([
        request('/api/resources/mine'),
        request('/api/resources/requests')
      ]);
      renderOwnedResources(ownedResult.resources);
      renderBorrowRequests(requestResult.requests);
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  function renderOwnedResources(resources) {
    const list = byId('ownedResources');
    if (!list) return;
    list.replaceChildren();
    if (!resources.length) list.append(element('p', 'empty-inline', 'You haven’t listed anything yet.'));
    for (const resource of resources) {
      const row = element('div', 'dashboard-item');
      const info = element('div');
      info.append(element('strong', '', resource.title), element('small', '', resource.category));
      const actions = element('div', 'item-actions');
      actions.append(statusPill(resource.availability));
      const edit = element('button', 'small-button', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => openEditDialog(resource));
      const toggle = element('button', 'small-button', resource.availability === 'available' ? 'Mark unavailable' : 'Make available');
      toggle.type = 'button';
      toggle.addEventListener('click', () => updateResource(resource.id, { availability: resource.availability === 'available' ? 'unavailable' : 'available' }));
      const remove = element('button', 'small-button danger', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteResource(resource.id));
      actions.append(edit, toggle, remove);
      row.append(info, actions);
      list.append(row);
    }
  }

  function renderBorrowRequests(requests) {
    const list = byId('borrowRequests');
    if (!list) return;
    list.replaceChildren();
    if (!requests.length) list.append(element('p', 'empty-inline', 'No borrowing requests yet.'));
    for (const requestItem of requests) {
      const row = element('div', 'dashboard-item');
      const info = element('div');
      info.append(
        element('strong', '', requestItem.resource_title),
        element('small', '', requestItem.borrower_id === state.user.id
          ? `Requested from ${requestItem.owner_name}`
          : `Requested by ${requestItem.borrower_name}`)
      );
      if (requestItem.message) info.append(element('small', '', requestItem.message));
      const actions = element('div', 'item-actions');
      actions.append(statusPill(requestItem.status));
      if (requestItem.owner_id === state.user.id && requestItem.status === 'pending') {
        actions.append(actionButton('Approve', () => decideRequest(requestItem.id, 'approved')));
        actions.append(actionButton('Decline', () => decideRequest(requestItem.id, 'rejected'), true));
      } else if (requestItem.status === 'approved') {
        actions.append(actionButton('Mark returned', () => returnResource(requestItem.id)));
      }
      row.append(info, actions);
      list.append(row);
    }
  }

  function actionButton(label, callback, danger = false) {
    const button = element('button', `small-button${danger ? ' danger' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  async function decideRequest(id, status) {
    try {
      const result = await request(`/api/resources/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showMessage(result.message, 'success');
      await Promise.all([refreshDashboard(), loadResources()]);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function returnResource(id) {
    try {
      const result = await request(`/api/resources/requests/${id}/return`, { method: 'POST', body: '{}' });
      showMessage(result.message, 'success');
      await Promise.all([refreshDashboard(), loadResources()]);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function updateResource(id, values) {
    try {
      const result = await request(`/api/resources/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
      showMessage(result.message, 'success');
      await Promise.all([refreshDashboard(), loadResources()]);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function deleteResource(id) {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    try {
      await request(`/api/resources/${id}`, { method: 'DELETE' });
      showMessage('Resource listing deleted.', 'success');
      await Promise.all([refreshDashboard(), loadResources()]);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  function openEditDialog(resource) {
    state.editingResource = resource;
    const form = byId('editResourceForm');
    form.elements.title.value = resource.title;
    form.elements.description.value = resource.description;
    form.elements.category.value = resource.category;
    byId('editDialog').showModal();
  }

  async function saveResourceEdit(event) {
    event.preventDefault();
    if (!state.editingResource) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const result = await request(`/api/resources/${state.editingResource.id}`, { method: 'PATCH', body: JSON.stringify(values) });
      byId('editDialog').close();
      showMessage(result.message, 'success');
      await Promise.all([refreshDashboard(), loadResources()]);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function renderAdminDashboard() {
    const panel = byId('adminDashboard');
    panel.replaceChildren();
    const header = element('div', 'dashboard-head');
    const heading = element('div');
    heading.append(element('p', 'eyebrow', 'CAMPUS ADMINISTRATION'), element('h3', '', 'Admin dashboard'));
    const logoutButton = element('button', 'small-button', 'Log out');
    logoutButton.type = 'button';
    logoutButton.addEventListener('click', logout);
    header.append(heading, logoutButton);
    panel.append(header, element('p', 'dashboard-subtitle', 'Review registrations and keep authorized student batches up to date.'));

    const registrationSection = element('section', 'dashboard-section');
    registrationSection.append(element('h4', '', 'Pending registrations'));
    const registrations = element('div', 'dashboard-list');
    registrations.id = 'pendingRegistrations';
    registrationSection.append(registrations);
    panel.append(registrationSection);

    const batches = element('section', 'dashboard-section');
    batches.append(element('h4', '', 'Authorized batches'));
    const batchForm = element('form', 'dashboard-form');
    const yearLabel = element('label', '', 'Add or update batch year');
    const year = element('input');
    year.type = 'number';
    year.name = 'year';
    year.min = '1900';
    year.max = '2200';
    year.required = true;
    year.placeholder = 'e.g. 2027';
    yearLabel.append(year);
    batchForm.append(yearLabel);
    const activeLabel = element('label', '', 'Registration and access');
    const activeSelect = element('select');
    activeSelect.name = 'active';
    const activeOption = element('option', '', 'Active');
    activeOption.value = 'true';
    const inactiveOption = element('option', '', 'Inactive');
    inactiveOption.value = 'false';
    activeSelect.append(activeOption, inactiveOption);
    activeLabel.append(activeSelect);
    batchForm.append(activeLabel);
    const batchButton = element('button', 'button button-dark', 'Save batch');
    batchButton.type = 'submit';
    batchForm.append(batchButton);
    batchForm.addEventListener('submit', saveBatch);
    batches.append(batchForm);
    const batchList = element('div', 'dashboard-list');
    batchList.id = 'batchList';
    batchList.classList.add('admin-batch-list');
    batches.append(batchList);
    panel.append(batches);
    await loadAdminData();
  }

  async function loadAdminData() {
    try {
      const [registrationResult, batchResult] = await Promise.all([
        request('/api/admin/registrations'),
        request('/api/admin/batches')
      ]);
      renderRegistrations(registrationResult.registrations);
      renderBatches(batchResult.batches);
    } catch (error) { showMessage(error.message, 'error'); }
  }

  function renderRegistrations(registrations) {
    const list = byId('pendingRegistrations');
    list.replaceChildren();
    if (!registrations.length) list.append(element('p', 'empty-inline', 'You’re all caught up—no pending reviews.'));
    for (const registration of registrations) {
      const row = element('article', 'dashboard-item');
      const info = element('div');
      info.append(element('strong', '', registration.full_name), element('small', '', `${registration.email} · ${registration.student_id} · Batch ${registration.batch_year}`));
      const result = typeof registration.card_check_result === 'string'
        ? safeParse(registration.card_check_result) : registration.card_check_result;
      const cardResult = element('p', 'admin-result', `Card check: ${registration.card_check_status}${result ? ` · Printed ID ${result.printedIdMatched ? 'matched' : 'not matched'} (${result.printedId || 'unreadable'}), QR ${result.qrIdMatched ? 'matched' : 'not matched'} (${result.qrStudentId || 'unreadable'}), college ${result.collegeNameMatched ? 'found' : 'not found'}` : ''}. Automated checks are not proof of authenticity.`);
      info.append(cardResult);
      const image = element('img', 'admin-card-image');
      image.src = `/api/admin/registrations/${registration.id}/id-card`;
      image.alt = `Student ID card submitted by ${registration.full_name}`;
      image.loading = 'lazy';
      info.append(image);
      const actions = element('div', 'item-actions');
      actions.append(actionButton('Approve', () => reviewRegistration(registration.id, 'approved')));
      actions.append(actionButton('Reject', () => reviewRegistration(registration.id, 'rejected'), true));
      row.append(info, actions);
      list.append(row);
    }
  }

  function renderBatches(batches) {
    const list = byId('batchList');
    list.replaceChildren();
    if (!batches.length) list.append(element('p', 'empty-inline', 'No batches configured yet. Add one above.'));
    for (const batch of batches) {
      const row = element('div', 'dashboard-item');
      const info = element('div');
      info.append(element('strong', '', `Batch ${batch.batch_year}`), element('small', '', `${batch.student_count} student accounts`));
      const toggle = element('button', 'small-button', batch.active ? 'Deactivate' : 'Activate');
      toggle.type = 'button';
      toggle.addEventListener('click', () => updateBatch(batch.batch_year, !batch.active));
      row.append(info, element('div', 'item-actions', ''), statusPill(batch.active ? 'available' : 'inactive'));
      row.querySelector('.item-actions').append(toggle);
      list.append(row);
    }
  }

  async function reviewRegistration(id, status) {
    try {
      const result = await request(`/api/admin/registrations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showMessage(result.message, 'success');
      await loadAdminData();
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function saveBatch(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const year = form.elements.year.value;
    const active = form.elements.active.value === 'true';
    await updateBatch(year, active);
    form.reset();
  }

  async function updateBatch(year, active) {
    try {
      const result = await request(`/api/admin/batches/${year}`, { method: 'PUT', body: JSON.stringify({ active }) });
      showMessage(result.message, 'success');
      await loadAdminData();
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
      state.user = null;
      await refreshCsrf();
      resetAccountPanels();
      await renderAccount(null);
      showMessage('You have been logged out.', 'success');
      await loadResources();
    } catch (error) { showMessage(error.message, 'error'); }
  }

  byId('loginTab').addEventListener('click', () => setFormTab(false));
  byId('registerTab').addEventListener('click', () => setFormTab(true));
  document.querySelectorAll('[data-open-register]').forEach((button) => button.addEventListener('click', () => {
    if (state.user) return;
    setFormTab(true);
    document.querySelector('#account').scrollIntoView({ behavior: 'smooth' });
    byId('primaryNav').classList.remove('open');
    byId('menuToggle').setAttribute('aria-expanded', 'false');
  }));
  byId('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const credentials = Object.fromEntries(new FormData(event.currentTarget));
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      await refreshCsrf();
      await renderAccount(result.user);
      showMessage(result.user.approvalStatus === 'approved' || result.user.role === 'admin' ? 'Welcome back!' : 'You’re signed in. Your account is waiting for review.', 'success');
      await loadResources();
    } catch (error) { showMessage(error.message, 'error'); }
    finally { submit.disabled = false; }
  });
  byId('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const result = await request('/api/auth/register', { method: 'POST', body: new FormData(event.currentTarget) });
      showMessage(`${result.message} Card check: ${result.cardCheckStatus.replace('_', ' ')}.`, 'success');
      event.currentTarget.reset();
      setFormTab(false);
      showMessage(`${result.message} Card check: ${result.cardCheckStatus.replace('_', ' ')}.`, 'success');
    } catch (error) { showMessage(error.message, 'error'); }
    finally { submit.disabled = false; }
  });
  byId('resourceSearch').addEventListener('input', debounce(loadResources, 220));
  byId('categoryFilter').addEventListener('change', loadResources);
  byId('editResourceForm').addEventListener('submit', saveResourceEdit);
  byId('closeResourceDialog').addEventListener('click', () => byId('resourceDialog').close());
  byId('menuToggle').addEventListener('click', () => {
    const open = byId('primaryNav').classList.toggle('open');
    byId('menuToggle').setAttribute('aria-expanded', String(open));
  });
  byId('primaryNav').querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    byId('primaryNav').classList.remove('open');
    byId('menuToggle').setAttribute('aria-expanded', 'false');
  }));

  function debounce(callback, delay) {
    let timer;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  async function initialize() {
    try {
      await refreshCsrf();
      const result = await request('/api/auth/me');
      await renderAccount(result.user);
    } catch (error) {
      showMessage(error.message, 'error');
    }
    await loadResources();
  }

  initialize();
})();

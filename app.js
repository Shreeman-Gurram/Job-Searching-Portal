// Simple JobHub dashboard with CRUD, filters, sorting and details

// Configuration
const JOBS_API = 'https://jsonfakery.com/jobs';
let API_KEY = 'demo-key-123'; // default, overridden by data-api-key on body

// Local storage keys
const LS_JOBS = 'jobhub.jobs';
const LS_APPS = 'jobhub.applications';

// State
let allJobs = [];
let filteredJobs = [];
let selectedJob = null;
let role = 'seeker';
let urlSyncEnabled = true;
let salaryFilter = { min: null, max: null };
let companyFilter = 'all';

// Static filter options per template
const FILTERS = {
	type: ['Full Time', 'Part Time', 'Contract', 'Remote'],
	location: ['San Francisco', 'New York', 'London', 'Berlin'],
	experience: ['Entry', 'Mid', 'Senior']
};

// Utilities
function saveJobsToStorage(jobs) { localStorage.setItem(LS_JOBS, JSON.stringify(jobs)); }
function loadJobsFromStorage() { return JSON.parse(localStorage.getItem(LS_JOBS) || '[]'); }
function saveApplications(apps) { localStorage.setItem(LS_APPS, JSON.stringify(apps)); }
function loadApplications() { return JSON.parse(localStorage.getItem(LS_APPS) || '[]'); }

function formatSalary(min, max) {
	if (min == null || max == null) return '—';
	const fmt = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
	return `$${fmt(min)} - $${fmt(max)}`;
}

function renderFilters() {
	const mount = (id, items, group) => {
		const container = document.getElementById(id);
		container.innerHTML = items.map(v => {
			const value = v;
			const inputId = `${group}-${value.replace(/\s+/g,'').toLowerCase()}`;
			return `<label><span><input type="checkbox" data-group="${group}" value="${value}" id="${inputId}"> ${value}</span><span class="count" data-count-for="${group}:${value}"></span></label>`;
		}).join('');
	};
	mount('filter-type', FILTERS.type, 'type');
	mount('filter-location', FILTERS.location, 'location');
	mount('filter-experience', FILTERS.experience, 'experience');

	document.getElementById('filters').addEventListener('change', applyFiltersSortSearch);
}

function normalizeValueToTemplate(value, list) {
	if (!value) return list[0];
	const val = String(value).trim();
	// Try case-insensitive match, also unify dashes/commas
	const simplified = val.toLowerCase().replace(/[-_]/g,' ').replace(/,.*$/,'').trim();
	const found = list.find(opt => opt.toLowerCase() === simplified);
	if (found) return found;
	// Heuristics for employment type
	if (simplified.includes('full')) return 'Full Time';
	if (simplified.includes('part')) return 'Part Time';
	if (simplified.includes('contract')) return 'Contract';
	if (simplified.includes('remote')) return 'Remote';
	// Heuristics for experience
	if (simplified.startsWith('entry')) return 'Entry';
	if (simplified.startsWith('junior')) return 'Entry';
	if (simplified.startsWith('mid')) return 'Mid';
	if (simplified.startsWith('sen')) return 'Senior';
	// Locations: trim to city only
	for (const city of FILTERS.location) {
		if (simplified.startsWith(city.toLowerCase())) return city;
	}
	return list.includes(value) ? value : list[0];
}

async function fetchJobs() {
	try {
		const res = await fetch(JOBS_API, { headers: { 'x-api-key': API_KEY }});
		const data = await res.json();
		// Normalize minimal fields we use
		const normalized = (Array.isArray(data) ? data : data?.data || []).map((j, idx) => ({
			id: j.id ?? `api-${idx}`,
			title: j.title || j.position || 'Untitled Role',
			company: j.company || j.company_name || 'Company',
			location: normalizeValueToTemplate(j.location || j.city, FILTERS.location),
			employment_type: normalizeValueToTemplate(j.type || j.employment_type, FILTERS.type),
			salary_min: j.salary_min ?? j.salary?.min ?? 90000,
			salary_max: j.salary_max ?? j.salary?.max ?? 150000,
			tags: j.tags || j.skills || ['React','TypeScript','Nextjs'],
			description: j.description || 'No description provided.',
			requirements: j.requirements || ['3+ years experience','Strong JS/TS','Good communication'],
			benefits: j.benefits || ['Health insurance','Flexible hours','Remote friendly'],
			date: j.date || j.created_at || new Date().toISOString(),
			experience: normalizeValueToTemplate(j.experience, FILTERS.experience)
		}));
		return normalized;
	} catch (e) {
		console.error('Failed to fetch API jobs, falling back to storage', e);
		return [];
	}
}

function mergeApiWithLocal(apiJobs, localJobs) {
	// Local jobs override by id; include API jobs as baseline
	const byId = new Map(apiJobs.map(j => [String(j.id), j]));
	for (const j of localJobs) byId.set(String(j.id), j);
	return Array.from(byId.values());
}

function applyFiltersSortSearch() {
	const text = document.getElementById('searchInput').value.trim().toLowerCase();
	const sort = document.getElementById('sortSelect').value;
    const checked = Array.from(document.querySelectorAll('#filters input[type="checkbox"]:checked'))
		.reduce((acc, el) => { (acc[el.dataset.group] ||= new Set()).add(el.value); return acc; }, {});

    filteredJobs = allJobs.filter(j => {
		const passType = !checked.type || checked.type.has(j.employment_type);
		const passLoc = !checked.location || checked.location.has(j.location);
		const passExp = !checked.experience || checked.experience.has(j.experience);
		const inText = !text || [j.title, j.company, j.location, j.employment_type, ...(j.tags||[])].some(v => String(v).toLowerCase().includes(text));
        const passSalaryMin = salaryFilter.min == null || (j.salary_max ?? 0) >= salaryFilter.min;
        const passSalaryMax = salaryFilter.max == null || (j.salary_min ?? 0) <= salaryFilter.max;
        const passCompany = companyFilter === 'all' || j.company === companyFilter;
        return passType && passLoc && passExp && inText && passSalaryMin && passSalaryMax && passCompany;
	});

	filteredJobs.sort((a,b) => {
		if (sort === 'dateDesc') return new Date(b.date) - new Date(a.date);
		if (sort === 'dateAsc') return new Date(a.date) - new Date(b.date);
		if (sort === 'salaryDesc') return (b.salary_max||0) - (a.salary_max||0);
		if (sort === 'salaryAsc') return (a.salary_min||0) - (b.salary_min||0);
		if (sort === 'titleAsc') return a.title.localeCompare(b.title);
		if (sort === 'titleDesc') return b.title.localeCompare(a.title);
		return 0;
	});

	updateCounts();
	renderJobs();
	if (urlSyncEnabled) updateUrlFromState();
}

function updateCounts() {
	const countMap = { type: new Map(), location: new Map(), experience: new Map() };
	for (const j of allJobs) {
		countMap.type.set(j.employment_type, (countMap.type.get(j.employment_type)||0)+1);
		countMap.location.set(j.location, (countMap.location.get(j.location)||0)+1);
		countMap.experience.set(j.experience, (countMap.experience.get(j.experience)||0)+1);
	}
	for (const [group, map] of Object.entries(countMap)) {
		for (const opt of FILTERS[group]) {
			const span = document.querySelector(`[data-count-for="${group}:${opt}"]`);
			if (span) span.textContent = `(${map.get(opt)||0})`;
		}
	}
}

function renderJobs() {
	const list = document.getElementById('jobsList');
	list.innerHTML = '';
	const count = document.getElementById('jobsCount');
	count.textContent = `${filteredJobs.length} jobs found`;

	for (const job of filteredJobs) {
		const card = document.createElement('div');
		card.className = 'card job-card';
		card.innerHTML = `
			<div>
				<h3>${job.title}</h3>
				<div class="job-meta">
					<span>📍 ${job.location}</span>
					<span>💼 ${job.employment_type}</span>
					<span>💰 ${formatSalary(job.salary_min, job.salary_max)}</span>
				</div>
				<div class="badges">${(job.tags||[]).slice(0,6).map(t => `<button class="badge" data-tag="${t}">${t}</button>`).join('')}</div>
			</div>
			<div class="apply-btn">
				<button class="btn primary" data-apply="${job.id}">Apply Now</button>
			</div>
		`;
		card.addEventListener('click', (e) => {
			if (e.target.matches('button[data-apply]')) return; // handled separately
			selectJob(job);
		});
		card.querySelector('button[data-apply]').addEventListener('click', () => applyForJob(job));
		card.querySelectorAll('[data-tag]').forEach(btn => btn.addEventListener('click', (e)=>{ e.stopPropagation(); addSearchToken(btn.dataset.tag); }));
		list.appendChild(card);
	}
}

function selectJob(job) {
	selectedJob = job;
	const dc = document.getElementById('detailsCard');
	dc.classList.remove('empty');
	dc.innerHTML = `
		<div class="salary-box">${formatSalary(job.salary_min, job.salary_max)}<div style="font-size:12px; font-weight:600">per year</div></div>
		<h2 style="margin-top:12px">${job.title}</h2>
		<div class="job-meta" style="margin:6px 0 12px">
			<span>🏢 ${job.company}</span>
			<span>📍 ${job.location}</span>
			<span>💼 ${job.employment_type}</span>
		</div>
		<div class="badges" style="margin-bottom:8px">${(job.tags||[]).map(t=>`<button class=badge data-tag="${t}">${t}</button>`).join('')}</div>
		<div class="details-section">
			<h4>Job Description</h4>
			<p>${job.description}</p>
			<h4>Requirements</h4>
			<ul>${(job.requirements||[]).map(r=>`<li>${r}</li>`).join('')}</ul>
			<h4>Benefits</h4>
			<ul>${(job.benefits||[]).map(b=>`<li>${b}</li>`).join('')}</ul>
		</div>
		<div style="margin-top:14px; display:flex; gap:8px">
			<button class="btn primary" id="detailsApply">Apply for this Position</button>
			${role==='recruiter' ? '<button class="btn" id="editJob">Edit</button>' : ''}
		</div>
	`;
	document.getElementById('detailsApply').addEventListener('click', () => applyForJob(job));
	if (role === 'recruiter') document.getElementById('editJob').addEventListener('click', openEditJob);
	dc.querySelectorAll('[data-tag]').forEach(btn => btn.addEventListener('click', (e)=>{ e.stopPropagation(); addSearchToken(btn.dataset.tag); }));
	if (urlSyncEnabled) updateUrlFromState();
}

function applyForJob(job) {
	const apps = loadApplications();
	if (!apps.find(a => a.jobId === job.id)) {
		apps.push({ jobId: job.id, date: new Date().toISOString() });
		saveApplications(apps);
		alert('Application submitted!');
	} else {
		alert('You already applied to this job.');
	}
}

// CRUD
function openCreateJob() {
	if (role !== 'recruiter') { alert('Only recruiters can post jobs.'); return; }
	openModal();
	const form = document.getElementById('jobForm');
	form.reset();
	form.id.value = '';
	document.getElementById('modalTitle').textContent = 'Post a Job';
	document.getElementById('deleteJobBtn').style.display = 'none';
}

function openEditJob() {
	if (role !== 'recruiter' || !selectedJob) return;
	openModal();
	const form = document.getElementById('jobForm');
	form.id.value = selectedJob.id;
	form.title.value = selectedJob.title;
	form.company.value = selectedJob.company;
	form.location.value = selectedJob.location;
	form.employment_type.value = selectedJob.employment_type;
	form.salary_min.value = selectedJob.salary_min || '';
	form.salary_max.value = selectedJob.salary_max || '';
	form.tags.value = (selectedJob.tags||[]).join(', ');
	form.description.value = selectedJob.description || '';
	form.requirements.value = (selectedJob.requirements||[]).join('\n');
	form.benefits.value = (selectedJob.benefits||[]).join('\n');
	document.getElementById('modalTitle').textContent = 'Edit Job';
	document.getElementById('deleteJobBtn').style.display = 'inline-block';
}

function openModal() { document.getElementById('jobModal').classList.remove('hidden'); }
function closeModal() { document.getElementById('jobModal').classList.add('hidden'); }

function upsertJobFromForm(e) {
	e.preventDefault();
	const fd = new FormData(e.target);
	const job = Object.fromEntries(fd.entries());
	job.id = job.id || `local-${Date.now()}`;
	job.salary_min = Number(job.salary_min); job.salary_max = Number(job.salary_max);
	job.tags = job.tags ? job.tags.split(',').map(s=>s.trim()).filter(Boolean) : [];
	job.requirements = job.requirements ? job.requirements.split('\n').map(s=>s.trim()).filter(Boolean) : [];
	job.benefits = job.benefits ? job.benefits.split('\n').map(s=>s.trim()).filter(Boolean) : [];
	job.date = new Date().toISOString();
	job.experience = job.experience || 'Mid';

	const local = loadJobsFromStorage();
	const idx = local.findIndex(j => String(j.id) === String(job.id));
	if (idx >= 0) local[idx] = job; else local.push(job);
	saveJobsToStorage(local);

	allJobs = mergeApiWithLocal(allJobs.filter(j=>String(j.id).startsWith('api-')), local);
	applyFiltersSortSearch();
	selectJob(job);
	closeModal();
}

function deleteJob() {
	const form = document.getElementById('jobForm');
	const id = form.id.value;
	if (!id) { closeModal(); return; }
	if (!confirm('Delete this job?')) return;
	const local = loadJobsFromStorage().filter(j => String(j.id) !== String(id));
	saveJobsToStorage(local);
	allJobs = mergeApiWithLocal(allJobs.filter(j=>String(j.id).startsWith('api-')), local);
	applyFiltersSortSearch();
	closeModal();
}

// Bootstrap
async function init() {
	API_KEY = document.body.getAttribute('data-api-key') || API_KEY;
	role = document.getElementById('roleSelect').value;
	renderFilters();

	const [apiJobs, localJobs] = await Promise.all([fetchJobs(), loadJobsFromStorage()]);
	allJobs = mergeApiWithLocal(apiJobs, localJobs);
	filteredJobs = [...allJobs];
	updateCounts();
	renderJobs();
    // Populate companies select
    const companies = Array.from(new Set(allJobs.map(j => j.company))).sort();
    const sel = document.getElementById('companySelect');
    if (sel) {
        for (const c of companies) {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c; sel.appendChild(opt);
        }
    }

	// Event wiring
	document.getElementById('searchInput').addEventListener('input', applyFiltersSortSearch);
	document.getElementById('sortSelect').addEventListener('change', applyFiltersSortSearch);
	document.getElementById('postJobBtn').addEventListener('click', openCreateJob);
	document.getElementById('roleSelect').addEventListener('change', (e)=>{ role = e.target.value; selectJob(selectedJob||filteredJobs[0]||null); });
	document.getElementById('modalClose').addEventListener('click', closeModal);
	document.getElementById('jobForm').addEventListener('submit', upsertJobFromForm);
	document.getElementById('deleteJobBtn').addEventListener('click', deleteJob);

	// Smooth scroll for navbar links
	document.querySelectorAll('.nav-links a[data-nav]').forEach(a => {
		a.addEventListener('click', (e) => {
			e.preventDefault();
			const id = a.getAttribute('href');
			const el = document.querySelector(id);
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	});

    // Home button -> scroll to jobs
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.addEventListener('click', () => {
        document.getElementById('jobs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

	// URL -> state hydration (after jobs loaded)
	urlSyncEnabled = false;
	hydrateStateFromUrl();
	urlSyncEnabled = true;
	// Fallback selection
	if (!selectedJob && filteredJobs[0]) selectJob(filteredJobs[0]);

	// Clear filters
	document.getElementById('clearFilters').addEventListener('click', () => {
		urlSyncEnabled = false;
		document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => cb.checked = false);
		document.getElementById('searchInput').value = '';
		document.getElementById('sortSelect').value = 'dateDesc';
		urlSyncEnabled = true;
		applyFiltersSortSearch();
	});

    // Company filter controls
    const companySelect = document.getElementById('companySelect');
    const clearCompany = document.getElementById('clearCompany');
    if (companySelect) companySelect.addEventListener('change', (e)=>{ companyFilter = e.target.value; applyFiltersSortSearch(); });
    if (clearCompany) clearCompany.addEventListener('click', ()=>{ companyFilter = 'all'; companySelect.value = 'all'; applyFiltersSortSearch(); });

    // Salary filter controls
    const applySalary = document.getElementById('applySalary');
    const clearSalary = document.getElementById('clearSalary');
    if (applySalary) applySalary.addEventListener('click', ()=>{
        const min = document.getElementById('salaryMin').value;
        const max = document.getElementById('salaryMax').value;
        salaryFilter.min = min ? Number(min) : null;
        salaryFilter.max = max ? Number(max) : null;
        applyFiltersSortSearch();
    });
    if (clearSalary) clearSalary.addEventListener('click', ()=>{
        salaryFilter = { min: null, max: null };
        document.getElementById('salaryMin').value = '';
        document.getElementById('salaryMax').value = '';
        applyFiltersSortSearch();
    });

    // Applications list
    renderApplications();
    const appsSort = document.getElementById('applicationsSort');
    const clearApps = document.getElementById('clearApplications');
    if (appsSort) appsSort.addEventListener('change', renderApplications);
    if (clearApps) clearApps.addEventListener('click', ()=>{ saveApplications([]); renderApplications(); });
}

document.addEventListener('DOMContentLoaded', init);

// URL state sync
function updateUrlFromState() {
	const params = new URLSearchParams();
	const text = document.getElementById('searchInput').value.trim();
	if (text) params.set('q', text);
	params.set('sort', document.getElementById('sortSelect').value);
	const checked = Array.from(document.querySelectorAll('#filters input[type="checkbox"]:checked'));
	if (checked.length) params.set('f', checked.map(el => `${el.dataset.group}:${encodeURIComponent(el.value)}`).join(','));
	if (selectedJob) params.set('job', selectedJob.id);
    if (companyFilter !== 'all') params.set('company', companyFilter);
    if (salaryFilter.min != null) params.set('min', String(salaryFilter.min));
    if (salaryFilter.max != null) params.set('max', String(salaryFilter.max));
	const url = `${location.pathname}?${params.toString()}${location.hash}`;
	history.replaceState(null, '', url);
}

function hydrateStateFromUrl() {
	const params = new URLSearchParams(location.search);
	const q = params.get('q') || '';
	const sort = params.get('sort') || 'dateDesc';
    const f = params.get('f');
    const jobId = params.get('job');
    companyFilter = params.get('company') || 'all';
    const min = params.get('min'); const max = params.get('max');
    salaryFilter.min = min ? Number(min) : null; salaryFilter.max = max ? Number(max) : null;
	// set fields
	document.getElementById('searchInput').value = q;
	document.getElementById('sortSelect').value = sort;
    const companySelectEl = document.getElementById('companySelect');
    if (companySelectEl) companySelectEl.value = companyFilter;
    if (salaryFilter.min != null) document.getElementById('salaryMin').value = salaryFilter.min;
    if (salaryFilter.max != null) document.getElementById('salaryMax').value = salaryFilter.max;
	if (f) {
		const parts = f.split(',');
		for (const p of parts) {
			const [g, v] = p.split(':');
			const sel = `#filters input[type="checkbox"][data-group="${g}"][value="${decodeURIComponent(v)}"]`;
			const el = document.querySelector(sel);
			if (el) el.checked = true;
		}
	}
	applyFiltersSortSearch();
	if (jobId) {
		const j = allJobs.find(j => String(j.id) === String(jobId));
		if (j) selectJob(j);
	}
}

// Applications rendering
function renderApplications() {
    const container = document.getElementById('applicationsList');
    if (!container) return;
    const sort = document.getElementById('applicationsSort').value;
    const apps = loadApplications();
    const joined = apps.map(a => ({
        ...a,
        job: allJobs.find(j => String(j.id) === String(a.jobId))
    })).filter(x => !!x.job);
    joined.sort((a,b) => {
        if (sort === 'dateDesc') return new Date(b.date) - new Date(a.date);
        if (sort === 'dateAsc') return new Date(a.date) - new Date(b.date);
        if (sort === 'titleAsc') return a.job.title.localeCompare(b.job.title);
        if (sort === 'titleDesc') return b.job.title.localeCompare(a.job.title);
        return 0;
    });
    if (!joined.length) { container.innerHTML = '<p style="color:#475569">No applications yet.</p>'; return; }
    container.innerHTML = joined.map(({job, date}) => `
        <div class="card" style="margin-bottom:8px">
            <div style="display:flex; justify-content:space-between; align-items:center">
                <div>
                    <strong>${job.title}</strong> at ${job.company}
                    <div class="job-meta"><span>${job.location}</span> <span>${job.employment_type}</span></div>
                </div>
                <div style="text-align:right; font-size:12px; color:#475569">Applied: ${new Date(date).toLocaleDateString()}</div>
            </div>
        </div>
    `).join('');
}

function addSearchToken(token) {
	const input = document.getElementById('searchInput');
	const cur = input.value.trim();
	input.value = cur ? `${cur} ${token}` : token;
	applyFiltersSortSearch();
}



import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
};

const hasFlag = (flag) => args.includes(flag);
const inputDir = getArg('--input-dir') || 'trivy-reports';
const reportsJson = getArg('--reports') || process.env.TRIVY_REPORTS;
const dryRun = hasFlag('--dry-run');

if (!reportsJson) {
  console.error('Missing --reports or TRIVY_REPORTS JSON payload.');
  process.exit(1);
}

let reports;
try {
  reports = JSON.parse(reportsJson);
} catch (error) {
  console.error(`Failed to parse reports JSON: ${error.message}`);
  process.exit(1);
}

const severityRank = (severity) => {
  const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  return order[severity] ?? 0;
};

const findReportPath = (fileName) => {
  if (!fs.existsSync(inputDir)) {
    return null;
  }
  const entries = fs.readdirSync(inputDir);
  for (const entry of entries) {
    const candidate = path.join(inputDir, entry, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const direct = path.join(inputDir, fileName);
  return fs.existsSync(direct) ? direct : null;
};

const vulnMap = new Map();

for (const report of reports) {
  if (!report?.file || !report?.image) {
    console.warn('Skipping report entry missing image or file.');
    continue;
  }
  const reportPath = findReportPath(report.file);
  if (!reportPath) {
    console.warn(`Missing Trivy report: ${report.file}`);
    continue;
  }
  const raw = fs.readFileSync(reportPath, 'utf8');
  if (!raw.trim()) {
    continue;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to parse ${report.file}: ${error.message}`);
    continue;
  }
  const results = Array.isArray(data.Results) ? data.Results : [];
  for (const result of results) {
    const vulns = Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const vuln of vulns) {
      const id = vuln.VulnerabilityID;
      if (!id) continue;
      let entry = vulnMap.get(id);
      if (!entry) {
        entry = {
          id,
          severity: vuln.Severity || 'UNKNOWN',
          title: vuln.Title || vuln.Description || '',
          primaryURL: vuln.PrimaryURL || '',
          images: new Set(),
          occurrences: [],
          occurrenceKeys: new Set()
        };
        vulnMap.set(id, entry);
      }
      if (severityRank(vuln.Severity) > severityRank(entry.severity)) {
        entry.severity = vuln.Severity;
      }
      entry.images.add(report.image);
      const pkgKey = [
        report.image,
        vuln.PkgName || '',
        vuln.InstalledVersion || '',
        vuln.FixedVersion || ''
      ].join('|');
      if (!entry.occurrenceKeys.has(pkgKey)) {
        entry.occurrenceKeys.add(pkgKey);
        entry.occurrences.push({
          image: report.image,
          pkgName: vuln.PkgName || 'unknown',
          installedVersion: vuln.InstalledVersion || 'unknown',
          fixedVersion: vuln.FixedVersion || ''
        });
      }
    }
  }
}

if (vulnMap.size === 0) {
  console.log('No vulnerabilities found to report.');
  process.exit(0);
}

const buildIssueBody = (entry) => {
  const images = Array.from(entry.images).sort();
  const lines = [];
  lines.push(`Vulnerability ID: ${entry.id}`);
  lines.push(`Severity: ${entry.severity}`);
  if (entry.title) {
    lines.push(`Title: ${entry.title}`);
  }
  if (entry.primaryURL) {
    lines.push(`Primary URL: ${entry.primaryURL}`);
  }
  lines.push('');
  lines.push('Affected images:');
  for (const image of images) {
    lines.push(`- ${image}`);
  }
  lines.push('');
  lines.push('Packages:');
  for (const occurrence of entry.occurrences) {
    const fixed = occurrence.fixedVersion ? ` (fixed: ${occurrence.fixedVersion})` : ' (no fix)';
    lines.push(`- ${occurrence.image}: ${occurrence.pkgName} ${occurrence.installedVersion}${fixed}`);
  }
  return lines.join('\n');
};

if (dryRun) {
  console.log(`Dry run: ${vulnMap.size} unique vulnerabilities.`);
  for (const entry of vulnMap.values()) {
    console.log(`- Vuln ${entry.id} (${entry.severity}) in ${Array.from(entry.images).length} image(s)`);
  }
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) {
  console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required to create issues.');
  process.exit(1);
}

const [owner, repoName] = repo.split('/');
if (!owner || !repoName) {
  console.error('GITHUB_REPOSITORY must be in owner/repo format.');
  process.exit(1);
}

const request = async (url, options = {}, retries = 3) => {
  for (let i = 0; i <= retries; i++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `token ${token}`,
        'user-agent': 'nia-universal-trivy-issue-bot',
        ...options.headers
      }
    });

    if (response.ok) {
      if (response.status === 204) return null;
      return response.json();
    }

    if (i < retries && (response.status === 403 || response.status === 429)) {
      const delay = Math.pow(2, i) * 1000;
      console.warn(`Rate limited (status ${response.status}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }
};

const fetchExistingVulnIds = async () => {
  const existingIds = new Set();
  let page = 1;
  const perPage = 100;

  console.log('Fetching existing open issues...');

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repoName}/issues?state=open&per_page=${perPage}&page=${page}`;
    const issues = await request(url);
    
    if (!issues || issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      const match = issue.title.match(/^Vuln\s+(.+)$/);
      if (match) {
        existingIds.add(match[1]);
      }
    }

    if (issues.length < perPage) {
      break;
    }
    page++;
  }

  console.log(`Found ${existingIds.size} existing vulnerability issues.`);
  return existingIds;
};

const existingVulnIds = await fetchExistingVulnIds();

for (const entry of vulnMap.values()) {
  if (existingVulnIds.has(entry.id)) {
    console.log(`Issue already exists for ${entry.id}`);
    continue;
  }

  const title = `Vuln ${entry.id}`;
  const issueUrl = `https://api.github.com/repos/${owner}/${repoName}/issues`;
  const body = buildIssueBody(entry);
  
  // Add a small delay to avoid hitting secondary rate limits when creating many issues
  await new Promise(resolve => setTimeout(resolve, 2000));

  await request(issueUrl, {
    method: 'POST',
    body: JSON.stringify({ title, body })
  });
  console.log(`Created issue for ${entry.id}`);
}

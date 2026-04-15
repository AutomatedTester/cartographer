import assert from 'assert';
import { WorkflowDetector } from '../build/workflow-detector.js';

function createElement(tag, text, score, attrs = {}) {
  return {
    path: `body > ${tag}`,
    tag,
    text,
    locator: `${tag}[data-test='${text.toLowerCase().replace(/\s+/g, '-')}']`,
    intentReasons: ['test'],
    intentScore: score,
    attributes: attrs,
  };
}

function createPage(url, title, elements, timestamp) {
  return {
    url,
    title,
    timestamp,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

function createSession(pages) {
  return {
    sessionId: 'test-session',
    startUrl: pages[0]?.url || 'https://example.com',
    pages,
    metadata: {
      startTime: Date.now(),
      totalPages: pages.length,
      totalElementsAnalyzed: pages.reduce((sum, p) => sum + p.highIntentElements.length, 0),
      totalHighIntentElements: pages.reduce((sum, p) => sum + p.highIntentElements.length, 0),
    },
    sessionState: {},
    workflows: [],
  };
}

function runDagDedupTest() {
  const now = Date.now();

  // This session can trigger both auth and form-style detections on the same path.
  const loginPage = createPage(
    'https://example.com/login',
    'Login',
    [
      createElement('form', 'Login form', 70),
      createElement('input', 'Email', 80, { type: 'email' }),
      createElement('input', 'Password', 85, { type: 'password' }),
      createElement('button', 'Login', 90, { type: 'submit' }),
    ],
    now
  );

  const dashboardPage = createPage(
    'https://example.com/dashboard',
    'Welcome Dashboard',
    [createElement('a', 'Profile', 65)],
    now + 1000
  );

  const session = createSession([loginPage, dashboardPage]);
  const workflows = WorkflowDetector.detect(session, 'heuristic', false);

  const pathKeyCount = new Map();
  for (const workflow of workflows) {
    const key = JSON.stringify(workflow.pageSequence);
    pathKeyCount.set(key, (pathKeyCount.get(key) || 0) + 1);
  }

  for (const count of pathKeyCount.values()) {
    assert.strictEqual(count, 1, 'DAG dedup should keep only one workflow per canonical path');
  }

  for (const workflow of workflows) {
    const uniquePages = new Set(workflow.pageSequence);
    assert.strictEqual(
      uniquePages.size,
      workflow.pageSequence.length,
      'DAG normalization should prune redundant/cyclic page steps'
    );
  }

  console.log('✓ workflow-dag-dedup-test passed');
  console.log(`  workflows detected: ${workflows.length}`);
  workflows.forEach((w) => {
    console.log(`  - ${w.name}: ${w.pageSequence.join(' -> ')}`);
  });
}

runDagDedupTest();

/* Fills the requested path into the auditor's report. textContent only; nothing is injected. */
(() => {
	'use strict';
	const el = document.querySelector('[data-path]');
	if (el) el.textContent = location.pathname;
})();

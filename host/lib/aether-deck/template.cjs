function resolvePath(variables, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, part) => value && typeof value === 'object' ? value[part] : undefined, variables);
}

function renderTemplate(input, variables, maxLength = 500) {
  return String(input || '').slice(0, maxLength).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, path) => {
    const value = resolvePath(variables, path);
    return value === undefined || value === null ? '' : String(value).slice(0, 200);
  });
}

module.exports = { renderTemplate, resolvePath };

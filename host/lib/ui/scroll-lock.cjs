'use strict';

function lockDocumentScroll(documentRef) {
  const previousOverflow = documentRef.body.style.overflow;
  documentRef.body.style.overflow = 'hidden';
  return () => {
    documentRef.body.style.overflow = previousOverflow;
  };
}

module.exports = { lockDocumentScroll };

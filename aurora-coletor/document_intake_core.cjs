"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDocumentIntakeEngine = createDocumentIntakeEngine;
exports.documentIntakeClientEngine = documentIntakeClientEngine;
function createDocumentIntakeEngine() {
    const VERSION = '1.0.0', MAX_BYTES = 1048576, MAX_TEXT = 262144, MAX_PARTS = 128, MAX_EXPANDED = 8388608;
    // Bound retained namespace maps as well as XML input/node counts. Charge
    // inherited entries BEFORE cloning, and new bindings BEFORE retaining them.
    const MAX_XML_NAMESPACES = 256, MAX_XML_NAMESPACE_ENTRIES = 262144;
    const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const ODF_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
    const ODF_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
    const ODF_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
    const XLINK = 'http://www.w3.org/1999/xlink';
    const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
    const reject = (code) => { throw new Error(code); };
    const need = (value, code = 'MALFORMED_DOCUMENT') => { if (!value)
        reject(code); };
    const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC');
    async function hash(bytes) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
        return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }
    function decode(bytes) { return normalize(decoder.decode(bytes)); }
    function unescapeXml(text) {
        need(!/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]{1,7};|#x[0-9a-fA-F]{1,6};)/.test(text));
        return text.replace(/&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/g, (_whole, key) => {
            const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
            if (Object.hasOwn(predefined, key))
                return predefined[key];
            const point = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
            need(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff));
            return String.fromCodePoint(point);
        });
    }
    function xml(input, prefix = 'xml') {
        need(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(input));
        const stack = [], nodes = [], leaves = [], segments = [];
        let offset = 0, roots = 0, nodeCount = 0, namespaceEntries = 0;
        function text(value, cdata = false) {
            if (!stack.length) {
                need(!value.trim());
                return;
            }
            const content = cdata ? value : unescapeXml(value), node = stack[stack.length - 1];
            node.text += content;
            if (content.trim())
                segments.push({ locator: node.locator + '/text()', text: content });
        }
        function close() {
            const node = stack.pop();
            if (!node.children.length && node.text.trim())
                leaves.push({ path: node.path, namespaceURI: node.namespaceURI,
                    namespacePath: node.namespacePath, text: node.text, locator: node.locator });
        }
        while (offset < input.length) {
            if (input[offset] !== '<') {
                const end = input.indexOf('<', offset);
                text(input.slice(offset, end < 0 ? input.length : end));
                offset = end < 0 ? input.length : end;
                continue;
            }
            if (input.startsWith('<!--', offset)) {
                const end = input.indexOf('-->', offset + 4);
                need(end >= 0 && !input.slice(offset + 4, end).includes('--'));
                offset = end + 3;
                continue;
            }
            if (input.startsWith('<![CDATA[', offset)) {
                const end = input.indexOf(']]>', offset + 9);
                need(end >= 0);
                text(input.slice(offset + 9, end), true);
                offset = end + 3;
                continue;
            }
            if (input.startsWith('<?', offset)) {
                const end = input.indexOf('?>', offset + 2);
                need(end >= 0 && offset === 0 && /^<\?xml\s+[^<>]*\?>$/.test(input.slice(offset, end + 2)));
                offset = end + 2;
                continue;
            }
            need(!input.startsWith('<!', offset)); // No DTD, entities, XInclude processing, or external fetch.
            let end = offset + 1, quote = '';
            for (; end < input.length; end++) {
                const char = input[end];
                if (quote) {
                    if (char === quote)
                        quote = '';
                }
                else if (char === '"' || char === "'")
                    quote = char;
                else if (char === '>')
                    break;
            }
            need(end < input.length && !quote);
            const token = input.slice(offset, end + 1);
            offset = end + 1;
            if (token.startsWith('</')) {
                const match = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>$/.exec(token);
                need(match && stack.length && stack[stack.length - 1].attrs['#qname'] === match[1]);
                close();
                continue;
            }
            const match = /^<([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*?)(\/?)>$/.exec(token);
            need(match);
            const qname = match[1], tail = match[2], selfClosing = match[3] === '/';
            need(/^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/.test(qname));
            need(++nodeCount <= 100000 && stack.length < 64, 'LIMIT_EXCEEDED');
            const parent = stack[stack.length - 1], inherited = parent?.namespaces ?? { xml: 'http://www.w3.org/XML/1998/namespace' };
            let namespaceCount = Object.keys(inherited).length;
            namespaceEntries += namespaceCount;
            need(namespaceEntries <= MAX_XML_NAMESPACE_ENTRIES, 'LIMIT_EXCEEDED');
            const namespaces = Object.assign(Object.create(null), inherited);
            const bindNamespace = (name, value) => {
                need(value.length <= 512, 'LIMIT_EXCEEDED');
                if (!Object.hasOwn(namespaces, name)) {
                    need(++namespaceCount <= MAX_XML_NAMESPACES && ++namespaceEntries <= MAX_XML_NAMESPACE_ENTRIES, 'LIMIT_EXCEEDED');
                }
                namespaces[name] = value;
            };
            const attrs = Object.assign(Object.create(null), { '#qname': qname });
            let at = 0;
            while (at < tail.length) {
                if (!tail.slice(at).trim())
                    break;
                const attr = /^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("[^"<]*"|'[^'<]*')/.exec(tail.slice(at));
                need(attr);
                const name = attr[1], value = unescapeXml(attr[2].slice(1, -1));
                need(!Object.hasOwn(attrs, name));
                attrs[name] = value;
                at += attr[0].length;
                if (name === 'xmlns')
                    bindNamespace('', value);
                else if (name.startsWith('xmlns:')) {
                    const key = name.slice(6);
                    need(key !== 'xmlns' && (key !== 'xml' || value === 'http://www.w3.org/XML/1998/namespace'));
                    bindNamespace(key, value);
                }
            }
            const qualified = qname.split(':'), local = qualified[qualified.length - 1], ns = qualified.length === 2 ? namespaces[qualified[0]] : namespaces[''] ?? '';
            need(ns !== undefined && ns.length <= 512 && (qualified.length !== 2 || ns.length > 0));
            const expandedAttrs = Object.create(null);
            for (const [name, value] of Object.entries(attrs)) {
                if (name === '#qname' || name === 'xmlns' || name.startsWith('xmlns:'))
                    continue;
                need(/^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/.test(name));
                const parts = name.split(':'), attributeNs = parts.length === 2 ? namespaces[parts[0]] : '';
                need(attributeNs !== undefined && (parts.length !== 2 || attributeNs.length > 0));
                const expanded = '{' + attributeNs + '}' + parts[parts.length - 1];
                need(!Object.hasOwn(expandedAttrs, expanded));
                expandedAttrs[expanded] = value;
            }
            const counts = parent?.counts ?? Object.create(null), number = (counts[qname] ?? 0) + 1;
            counts[qname] = number;
            const node = { name: local, namespaceURI: ns, path: [...(parent?.path ?? []), local], namespacePath: [...(parent?.namespacePath ?? []), ns],
                locator: (parent?.locator ?? prefix) + '/' + qname + '[' + number + ']', attrs, expandedAttrs, text: '', children: [], namespaces, counts: Object.create(null) };
            if (parent)
                parent.children.push(node);
            else {
                need(++roots === 1);
                nodes.push(node);
            }
            stack.push(node);
            if (selfClosing)
                close();
        }
        need(roots === 1 && stack.length === 0);
        return { nodes, leaves, segments };
    }
    function walk(nodes, name) { const out = []; for (const node of nodes) {
        if (node.name === name)
            out.push(node);
        out.push(...walk(node.children, name));
    } return out; }
    function nodeText(node) { return node.text + node.children.map(nodeText).join(''); }
    function attribute(node, namespace, name) { return node.expandedAttrs['{' + namespace + '}' + name]; }
    function csv(text) {
        const rows = [], row = [];
        let cell = '', quoted = false, afterQuote = false;
        const pushCell = () => { need(row.length < 128, 'LIMIT_EXCEEDED'); row.push(cell); cell = ''; afterQuote = false; };
        const pushRow = () => { pushCell(); need(rows.length < 10000, 'LIMIT_EXCEEDED'); rows.push(row.splice(0)); };
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (quoted) {
                if (char === '"') {
                    if (text[i + 1] === '"') {
                        cell += '"';
                        i++;
                    }
                    else {
                        quoted = false;
                        afterQuote = true;
                    }
                }
                else
                    cell += char;
                continue;
            }
            if (char === '"') {
                need(cell === '' && !afterQuote);
                quoted = true;
                continue;
            }
            if (char === ',') {
                pushCell();
                continue;
            }
            if (char === '\n') {
                pushRow();
                continue;
            }
            need(!afterQuote);
            cell += char;
        }
        need(!quoted);
        if (cell !== '' || row.length || afterQuote)
            pushRow();
        need(rows.length > 0);
        return rows;
    }
    function crc32(data) { let crc = 0xffffffff; for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    } return (crc ^ 0xffffffff) >>> 0; }
    async function inflate(bytes, expected, options) {
        if (options.inflateRaw)
            return options.inflateRaw(bytes, expected);
        let transform;
        try {
            transform = new DecompressionStream('deflate-raw');
        }
        catch {
            reject('BACKEND_REQUIRED');
        }
        const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(transform).getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const part = await stream.read();
                if (part.done)
                    break;
                total += part.value.length;
                need(total <= expected, 'LIMIT_EXCEEDED');
                chunks.push(part.value);
            }
        }
        catch (error) {
            await stream.cancel().catch(() => { });
            throw error;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
    async function zip(bytes, options) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map(), names = new Set(), ranges = [];
        const u16 = (at) => { need(at >= 0 && at + 2 <= bytes.length); return view.getUint16(at, true); }, u32 = (at) => { need(at >= 0 && at + 4 <= bytes.length); return view.getUint32(at, true); };
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
            if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
                eocd = i;
                break;
            }
        need(eocd >= 0 && u16(eocd + 4) === 0 && u16(eocd + 6) === 0 && u16(eocd + 8) === u16(eocd + 10));
        const count = u16(eocd + 10), centralStart = u32(eocd + 16), centralLength = u32(eocd + 12);
        need(count > 0 && count <= MAX_PARTS && centralStart + centralLength === eocd, 'LIMIT_EXCEEDED');
        let offset = centralStart, total = 0;
        for (let index = 0; index < count; index++) {
            need(u32(offset) === 0x02014b50);
            const flags = u16(offset + 8), method = u16(offset + 10), crc = u32(offset + 16), compressed = u32(offset + 20), expanded = u32(offset + 24), nameLength = u16(offset + 28), extra = u16(offset + 30), comment = u16(offset + 32), local = u32(offset + 42), attributes = u32(offset + 38);
            need(!(flags & 1), 'ENCRYPTED_DOCUMENT');
            need(!(flags & 8) && [0, 8].includes(method));
            const rawName = bytes.slice(offset + 46, offset + 46 + nameLength), name = decoder.decode(rawName);
            need(/^[A-Za-z0-9_./\[\]-]{1,240}$/.test(name) && !name.startsWith('/') && !name.includes('\\')
                && name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith('.')));
            need(!names.has(name.toLowerCase()));
            names.add(name.toLowerCase());
            need((attributes >>> 16 & 0xf000) !== 0xa000 && !(attributes & 0x400));
            need(expanded <= MAX_BYTES && (total += expanded) <= MAX_EXPANDED, 'LIMIT_EXCEEDED');
            need(u32(local) === 0x04034b50 && u16(local + 6) === flags && u16(local + 8) === method && u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === expanded);
            const localName = u16(local + 26), localExtra = u16(local + 28), begin = local + 30 + localName + localExtra, end = begin + compressed;
            need(localName === nameLength && bytes.slice(local + 30, local + 30 + localName).every((value, i) => value === rawName[i]) && end <= centralStart);
            need(!ranges.some(([start, finish]) => local < finish && end > start));
            ranges.push([local, end]);
            if (name.endsWith('/'))
                need(expanded === 0 && compressed === 0);
            else {
                const data = method === 0 ? bytes.slice(begin, end) : await inflate(bytes.slice(begin, end), expanded, options);
                need(data.length === expanded && crc32(data) === crc);
                files.set(name, data);
            }
            offset += 46 + nameLength + extra + comment;
            need(offset <= eocd);
        }
        need(offset === eocd);
        return files;
    }
    function partPath(base, target) {
        need(target.length > 0 && target.length <= 240 && !/[\\%?#:\u0000-\u0020]/.test(target));
        const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
        for (const item of target.replace(/^\//, '').split('/')) {
            if (item === '..') {
                need(parts.length > 0);
                parts.pop();
            }
            else if (item !== '.') {
                need(/^[A-Za-z0-9_.-]+$/.test(item));
                parts.push(item);
            }
        }
        return parts.join('/');
    }
    function packageRelationships(files, base) {
        const directory = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
        const filename = base.slice(base.lastIndexOf('/') + 1), path = base ? directory + '_rels/' + filename + '.rels' : '_rels/.rels';
        if (!files.has(path))
            return [];
        const document = xml(decode(files.get(path)), path), root = document.nodes[0];
        need(root.name === 'Relationships' && root.namespaceURI === PACKAGE_REL);
        const ids = new Set();
        return root.children.map(node => {
            need(node.name === 'Relationship' && node.namespaceURI === PACKAGE_REL && node.attrs.Id && node.attrs.Type && node.attrs.Target);
            need(!ids.has(node.attrs.Id));
            ids.add(node.attrs.Id);
            const external = node.attrs.TargetMode === 'External';
            need(node.attrs.TargetMode === undefined || external);
            return { id: node.attrs.Id, type: node.attrs.Type, external, path: external ? null : partPath(base, node.attrs.Target) };
        });
    }
    function officePackage(files, mainContentType) {
        need(files.has('[Content_Types].xml'));
        const content = xml(decode(files.get('[Content_Types].xml')), '[Content_Types].xml'), root = content.nodes[0];
        need(root.name === 'Types' && root.namespaceURI === CONTENT_TYPES);
        const types = new Map();
        for (const node of root.children) {
            need(node.namespaceURI === CONTENT_TYPES && ['Override', 'Default'].includes(node.name));
            if (node.name === 'Override') {
                need(node.attrs.PartName?.startsWith('/') && node.attrs.ContentType);
                const path = partPath('', node.attrs.PartName);
                need(!types.has(path));
                types.set(path, node.attrs.ContentType);
            }
        }
        const main = packageRelationships(files, '').filter(rel => rel.type === OFFICE_REL + '/officeDocument');
        need(main.length === 1 && !main[0].external && main[0].path && files.has(main[0].path) && types.get(main[0].path) === mainContentType);
        return { main: main[0].path, types };
    }
    async function extract(input, mime, options = {}) {
        // Reject BEFORE copying or hashing unbounded caller input.
        if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > MAX_BYTES) {
            return { byteSha256: '', byteLength: input?.byteLength ?? 0, text: '', segments: [], xmlLeaves: [], tables: [],
                extraction: { status: 'FAILED', method: null, methodVersion: VERSION, textSha256: null, textByteLength: 0,
                    coverage: { basis: 'EXPECTED_PARTS', totalUnits: 0, processedUnits: 0 }, code: input?.byteLength === 0 ? 'EMPTY_CONTENT' : 'LIMIT_EXCEEDED' } };
        }
        const bytes = new Uint8Array(input), byteSha256 = await hash(bytes), byteLength = bytes.length;
        const empty = { byteSha256, byteLength, text: '', segments: [], xmlLeaves: [], tables: [] };
        let method = null, totalUnits = 0, processedUnits = 0, partial = false;
        let segments = [], xmlLeaves = [], tables = [];
        try {
            need(bytes.length > 0, 'EMPTY_CONTENT');
            need(bytes.length <= MAX_BYTES, 'LIMIT_EXCEEDED');
            if (['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml'].includes(mime)) {
                const text = decode(bytes);
                need(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text));
                need(!text.startsWith('%PDF-') && !text.startsWith('PK\u0003\u0004'));
                need(text.trim(), 'EMPTY_CONTENT');
                totalUnits = processedUnits = 1;
                if (mime === 'text/csv') {
                    method = 'CSV_UTF8';
                    const rows = csv(text);
                    tables = [{ columns: rows[0], rows: rows.slice(1), rowLocators: rows.slice(1).map((_row, index) => 'csv/row[' + (index + 2) + ']') }];
                    totalUnits = processedUnits = rows.length;
                    segments = rows.map((row, index) => ({ locator: 'csv/row[' + (index + 1) + ']', text: row.join('\t') }));
                }
                else if (mime === 'application/json') {
                    method = 'JSON_UTF8';
                    const value = JSON.parse(text);
                    need(value !== null && typeof value === 'object');
                    segments = [{ locator: 'json/root', text }];
                }
                else if (mime === 'application/xml' || mime === 'text/xml') {
                    method = 'XML_TEXT';
                    const result = xml(text);
                    segments = result.segments;
                    xmlLeaves = result.leaves;
                }
                else {
                    method = 'TEXT_UTF8';
                    segments = [{ locator: 'text/body', text }];
                }
            }
            else if (mime === 'application/pdf') {
                need(bytes.length >= 8 && decoder.decode(bytes.subarray(0, 5)) === '%PDF-');
                need(options.extractPdfText, 'BACKEND_REQUIRED');
                const result = await options.extractPdfText(bytes);
                need(result?.schemaVersion === 'aurora.pdf.text.result.v1' && Number.isSafeInteger(result.pages) && result.pages > 0 && result.pages <= 32);
                need(Array.isArray(result.segments) && result.segments.length <= 20000, 'LIMIT_EXCEEDED');
                let expanded = 0;
                for (const segment of result.segments) {
                    need(segment && typeof segment.text === 'string' && segment.text.length <= MAX_TEXT
                        && /^pdf\/page\[[1-9][0-9]?\]\/item\[[1-9][0-9]{0,4}\]$/.test(segment.locator));
                    expanded += encoder.encode(segment.text).length + (segments.length ? 1 : 0);
                    need(expanded <= MAX_TEXT, 'LIMIT_EXCEEDED');
                    segments.push({ locator: segment.locator, text: segment.text });
                }
                // Page text is real; image/annotation/form/layout coverage is not OCR.
                // Never infer that text extraction covers every representation in PDF.
                method = 'PDF_TEXT';
                totalUnits = processedUnits = result.pages;
                partial = true;
            }
            else if (['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet'].includes(mime)) {
                const files = await zip(bytes, options);
                need(!Array.from(files.keys()).some(name => /vbaProject\.bin$|\/embeddings\//i.test(name)), 'BACKEND_REQUIRED');
                if (mime.includes('wordprocessingml')) {
                    method = 'DOCX_XML';
                    const pkg = officePackage(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
                    const relations = packageRelationships(files, pkg.main), textTypes = ['header', 'footer', 'footnotes', 'endnotes', 'comments'];
                    const paths = [pkg.main, ...relations.filter(rel => !rel.external && textTypes.some(kind => rel.type === OFFICE_REL + '/' + kind)).map(rel => rel.path)];
                    need(new Set(paths).size === paths.length);
                    let unsupported = relations.filter(rel => rel.external || !textTypes.some(kind => rel.type === OFFICE_REL + '/' + kind)
                        && !['styles', 'numbering', 'settings', 'webSettings', 'fontTable', 'theme'].some(kind => rel.type === OFFICE_REL + '/' + kind)).length;
                    for (const path of paths) {
                        need(files.has(path));
                        const result = xml(decode(files.get(path)), path);
                        need(result.nodes[0]?.namespaceURI === WORD && ['document', 'hdr', 'ftr', 'footnotes', 'endnotes', 'comments'].includes(result.nodes[0].name));
                        if (['altChunk', 'drawing', 'object', 'hyperlink'].some(name => walk(result.nodes, name).some(node => node.namespaceURI === WORD)))
                            unsupported++;
                        segments.push(...result.segments);
                        xmlLeaves.push(...result.leaves);
                        processedUnits++;
                    }
                    totalUnits = paths.length + unsupported;
                    partial = unsupported > 0;
                }
                else if (mime.includes('spreadsheetml')) {
                    method = 'XLSX_XML';
                    const pkg = officePackage(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
                    const workbook = xml(decode(files.get(pkg.main)), pkg.main);
                    need(workbook.nodes[0]?.namespaceURI === SHEET && workbook.nodes[0].name === 'workbook');
                    const relations = packageRelationships(files, pkg.main), sheetNodes = walk(workbook.nodes, 'sheet');
                    need(sheetNodes.length > 0);
                    const sheetPaths = sheetNodes.map(node => {
                        need(node.namespaceURI === SHEET);
                        const id = attribute(node, OFFICE_REL, 'id');
                        const matching = relations.filter(rel => rel.id === id && rel.type === OFFICE_REL + '/worksheet' && !rel.external);
                        need(matching.length === 1 && matching[0].path);
                        return matching[0].path;
                    });
                    need(new Set(sheetPaths).size === sheetPaths.length);
                    const sharedRelation = relations.filter(rel => rel.type === OFFICE_REL + '/sharedStrings' && !rel.external);
                    need(sharedRelation.length <= 1);
                    const sharedPath = sharedRelation[0]?.path;
                    const shared = sharedPath ? (need(files.has(sharedPath)), walk(xml(decode(files.get(sharedPath))).nodes, 'si').map(nodeText)) : [];
                    need(shared.length <= 10000, 'LIMIT_EXCEEDED');
                    totalUnits = sheetPaths.length;
                    // Shared-string references amplify encoded input. Reserve UTF-8 text,
                    // sparse-cell tabs and row separators before retaining values or join.
                    let expandedTextBytes = 0, expandedRows = 0;
                    const reserveText = (size) => { expandedTextBytes += size; need(expandedTextBytes <= MAX_TEXT, 'LIMIT_EXCEEDED'); };
                    partial = relations.some(rel => rel.external) || Array.from(files.keys()).some(path => /^xl\/(media|charts|drawings|embeddings)\//.test(path));
                    for (const path of sheetPaths) {
                        need(files.has(path) && pkg.types.get(path) === 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
                        const doc = xml(decode(files.get(path)), path), rows = [];
                        need(doc.nodes[0]?.namespaceURI === SHEET && doc.nodes[0].name === 'worksheet');
                        partial ||= packageRelationships(files, path).some(rel => rel.external)
                            || ['drawing', 'legacyDrawing', 'oleObjects'].some(name => walk(doc.nodes, name).length > 0);
                        for (const row of walk(doc.nodes, 'row')) {
                            need(rows.length < 10000, 'LIMIT_EXCEEDED');
                            const values = [];
                            if (expandedRows++)
                                reserveText(1);
                            need(row.namespaceURI === SHEET);
                            for (const cell of row.children.filter(node => node.name === 'c')) {
                                need(cell.namespaceURI === SHEET && cell.children.every(node => node.namespaceURI === SHEET));
                                const ref = /^([A-Z]{1,3})[1-9][0-9]*$/.exec(cell.attrs.r ?? '');
                                need(ref);
                                let column = 0;
                                for (const char of ref[1])
                                    column = column * 26 + char.charCodeAt(0) - 64;
                                need(column <= 128, 'LIMIT_EXCEEDED');
                                need(values[column - 1] === undefined);
                                const formula = cell.children.some(node => node.name === 'f');
                                if (formula)
                                    partial = true;
                                const raw = cell.children.find(node => node.name === 'v')?.text ?? '';
                                const value = formula ? '[FORMULA_NOT_EVALUATED]' : cell.attrs.t === 's' ? (need(/^[0-9]+$/.test(raw) && Number(raw) < shared.length), shared[Number(raw)]) :
                                    cell.attrs.t === 'inlineStr' ? nodeText(cell.children.find(node => node.name === 'is') ?? cell) : raw;
                                need(value.length <= MAX_TEXT, 'LIMIT_EXCEEDED');
                                reserveText(encoder.encode(value).length + Math.max(0, column - Math.max(1, values.length)));
                                values[column - 1] = value;
                            }
                            rows.push(Array.from({ length: values.length }, (_item, index) => values[index] ?? ''));
                        }
                        tables.push({ columns: rows[0] ?? [], rows: rows.slice(1), rowLocators: rows.slice(1).map((_row, index) => path + '/row[' + (index + 2) + ']') });
                        segments.push(...rows.map((row, index) => ({ locator: path + '/row[' + (index + 1) + ']', text: row.join('\t') })));
                        processedUnits++;
                    }
                }
                else {
                    method = mime.endsWith('.text') ? 'ODT_XML' : 'ODS_XML';
                    need(files.has('content.xml') && files.has('mimetype') && decode(files.get('mimetype')) === mime && files.has('META-INF/manifest.xml'));
                    const manifest = xml(decode(files.get('META-INF/manifest.xml')), 'META-INF/manifest.xml');
                    need(manifest.nodes[0]?.name === 'manifest' && manifest.nodes[0].namespaceURI === 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0');
                    const doc = xml(decode(files.get('content.xml')), 'content.xml');
                    segments = doc.segments;
                    xmlLeaves = doc.leaves;
                    totalUnits = processedUnits = 1;
                    need(doc.nodes[0]?.name === 'document-content' && doc.nodes[0].namespaceURI === ODF_OFFICE);
                    partial = walk(doc.nodes, 'scripts').length > 0 || walk(doc.nodes, 'script').length > 0 || walk(doc.nodes, 'object').length > 0;
                    // ODF references are namespace-based, never tied to a conventional
                    // Pictures/ directory. An image, object or link is not extracted by
                    // reading its caption, and binary-data is not document prose.
                    const pendingNodes = [...doc.nodes], binaryPrefixes = [];
                    while (pendingNodes.length) {
                        const node = pendingNodes.pop();
                        pendingNodes.push(...node.children);
                        if ((node.namespaceURI === ODF_DRAW && ['image', 'object', 'object-ole', 'plugin', 'applet', 'floating-frame'].includes(node.name))
                            || (attribute(node, XLINK, 'href') ?? '').trim() !== '')
                            partial = true;
                        if (node.namespaceURI === ODF_OFFICE && node.name === 'binary-data') {
                            need(node.children.length === 0);
                            partial = true;
                            binaryPrefixes.push(node.locator);
                        }
                    }
                    if (binaryPrefixes.length) {
                        const readable = (locator) => !binaryPrefixes.some(prefix => locator === prefix || locator.startsWith(prefix + '/'));
                        segments = segments.filter(segment => readable(segment.locator));
                        xmlLeaves = xmlLeaves.filter(leaf => readable(leaf.locator));
                    }
                    const readableNodeText = (node) => node.namespaceURI === ODF_OFFICE && node.name === 'binary-data' ? '' :
                        node.text + node.children.map(readableNodeText).join('');
                    if (method === 'ODS_XML')
                        for (const table of walk(doc.nodes, 'table')) {
                            const rows = [];
                            need(table.namespaceURI === ODF_TABLE);
                            for (const row of table.children.filter(node => node.name === 'table-row')) {
                                need(row.namespaceURI === ODF_TABLE);
                                const repeat = Number(attribute(row, ODF_TABLE, 'number-rows-repeated') ?? '1');
                                need(repeat === 1, 'LIMIT_EXCEEDED');
                                const values = [];
                                for (const cell of row.children.filter(node => node.name === 'table-cell' || node.name === 'covered-table-cell')) {
                                    need(cell.namespaceURI === ODF_TABLE);
                                    need(Number(attribute(cell, ODF_TABLE, 'number-columns-repeated') ?? '1') === 1, 'LIMIT_EXCEEDED');
                                    if (attribute(cell, ODF_TABLE, 'formula') !== undefined)
                                        partial = true;
                                    values.push(readableNodeText(cell));
                                }
                                need(values.length <= 128 && rows.length < 10000, 'LIMIT_EXCEEDED');
                                rows.push(values);
                            }
                            tables.push({ columns: rows[0] ?? [], rows: rows.slice(1), rowLocators: rows.slice(1).map((_row, index) => table.locator + '/row[' + (index + 2) + ']') });
                        }
                    // styles.xml may carry header/footer text and referenced images.
                    // This bounded reader does not interpret that part.
                    partial ||= files.has('styles.xml') || Array.from(files.keys()).some(name => /^(Pictures|Object[^/]*)\//.test(name));
                }
            }
            else
                reject(mime === 'application/pdf' || mime.startsWith('image/') ? 'BACKEND_REQUIRED' : 'UNSUPPORTED_FORMAT');
            const text = normalize(segments.map(segment => segment.text).join('\n')), encoded = encoder.encode(text);
            need(text.trim(), partial ? 'BACKEND_REQUIRED' : 'EMPTY_CONTENT');
            need(encoded.length <= MAX_TEXT, 'LIMIT_EXCEEDED');
            return { byteSha256, byteLength, text, segments, xmlLeaves, tables, extraction: { status: partial ? 'PARTIAL' : 'COMPLETE', method, methodVersion: VERSION,
                    textSha256: await hash(encoded), textByteLength: encoded.length, coverage: { basis: partial ? 'BOUNDED_REPRESENTATION' : 'EXPECTED_PARTS', totalUnits, processedUnits },
                    code: partial ? 'BOUNDED_EXTRACTION_PARTIAL' : 'CONTENT_EXTRACTED' } };
        }
        catch (error) {
            const code = error instanceof Error && ['BACKEND_REQUIRED', 'UNSUPPORTED_FORMAT', 'LIMIT_EXCEEDED', 'ENCRYPTED_DOCUMENT', 'EMPTY_CONTENT', 'SOURCE_CHANGED'].includes(error.message) ? error.message : 'MALFORMED_DOCUMENT';
            return { ...empty, extraction: { status: ['BACKEND_REQUIRED', 'UNSUPPORTED_FORMAT'].includes(code) ? 'PENDING' : 'FAILED', method: null, methodVersion: VERSION,
                    textSha256: null, textByteLength: 0, coverage: { basis: 'EXPECTED_PARTS', totalUnits: 0, processedUnits: 0 }, code } };
        }
    }
    return { version: VERSION, limits: { maxBytes: MAX_BYTES, maxTextBytes: MAX_TEXT, maxZipParts: MAX_PARTS, maxExpandedBytes: MAX_EXPANDED }, extract };
}
/** Emits the exact same implementation; no remote script, model, or worker URL. */
function documentIntakeClientEngine() {
    // The local identity shim also supports test instrumentation that preserves
    // function names. Production tsc emits no such helper; parsing stays identical.
    return `const documentIntakeEngine=(()=>{const __name=(value)=>value;return (${createDocumentIntakeEngine.toString()})();})();`;
}

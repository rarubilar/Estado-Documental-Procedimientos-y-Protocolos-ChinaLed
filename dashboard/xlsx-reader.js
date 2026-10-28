      // ---- Lector .xlsx compartido (se inserta al construir desde dashboard/xlsx-reader.js) ----
      const readXlsx = async (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        // Minimal zip reader (central directory + deflate-raw).
        const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
        const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
          if (u32(i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('El archivo no es un .xlsx válido.');
        const utf8 = new TextDecoder('utf-8');
        const entries = {};
        for (let k = 0, p = u32(eocd + 16), n = u16(eocd + 10); k < n; k++) {
          const nameLen = u16(p + 28);
          entries[utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen))] = { method: u16(p + 10), size: u32(p + 20), local: u32(p + 42) };
          p += 46 + nameLen + u16(p + 30) + u16(p + 32);
        }
        const readEntry = async (name) => {
          const e = entries[name.replace(/^\//, '')];
          if (!e) return null;
          const start = e.local + 30 + u16(e.local + 26) + u16(e.local + 28);
          const raw = bytes.subarray(start, start + e.size);
          if (e.method === 0) return utf8.decode(raw);
          const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return utf8.decode(await new Response(stream).arrayBuffer());
        };

        const attrs = (s) => { const o = {}; s.replace(/([\w:]+)="([^"]*)"/g, (m, k, v) => { o[k] = v; return m; }); return o; };
        const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, c) =>
          c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10))
            : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[c.toLowerCase()]);
        const texts = (xml) => {
          let out = '';
          xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { out += t; return m; });
          return unescape(out);
        };
        const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        const colName = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };


        const workbook = await readEntry('xl/workbook.xml');
        const rels = await readEntry('xl/_rels/workbook.xml.rels');
        if (!workbook || !rels) throw new Error('El .xlsx no tiene libro de trabajo.');
        const sstXml = (await readEntry('xl/sharedStrings.xml')) || '';
        const shared = [];
        sstXml.replace(/<si\b(?:[^>]*\/>|[^>]*>([\s\S]*?)<\/si>)/g, (m, inner) => { shared.push(inner ? texts(inner) : ''); return m; });

        // Cell fill colors: style index -> cellXfs fillId -> solid fgColor rgb.
        const stylesXml = (await readEntry('xl/styles.xml')) || '';
        const fills = [];
        ((stylesXml.match(/<fills\b[\s\S]*?<\/fills>/) || [''])[0]).replace(/<fill\b(?:[^>]*\/>|[^>]*>([\s\S]*?)<\/fill>)/g, (m, inner) => {
          const fg = /<fgColor\b[^>]*\brgb="([0-9A-Fa-f]{8})"/.exec(inner || '');
          fills.push(/patternType="solid"/.test(inner || '') && fg ? '#' + fg[1].slice(2).toUpperCase() : '');
          return m;
        });
        const xfFill = ((stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0].match(/<xf\b[^>]*>/g) || []).map((x) => Number(attrs(x).fillId || 0));

        const sheet = async (SHEET, MAX_ROW) => {
          const sheetTag = (workbook.match(/<sheet\b[^>]*>/g) || []).map(attrs).find((s) => (s.name || '').trim() === SHEET);
          if (!sheetTag) throw new Error('No se encontró la pestaña "' + SHEET + '".');
          const rel = (rels.match(/<Relationship\b[^>]*>/g) || []).map(attrs).find((r) => r.Id === sheetTag['r:id']);
          if (!rel) throw new Error('No se encontró la hoja de la pestaña "' + SHEET + '".');
          const sheetPath = rel.Target.startsWith('/') ? rel.Target.slice(1) : 'xl/' + rel.Target;

          const sheet = await readEntry(sheetPath);
          if (!sheet) throw new Error('No se pudo leer la pestaña "' + SHEET + '".');
          const grid = {};
          const styleOf = {};
          const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
          let rm;
          while ((rm = rowRe.exec(sheet))) {
            const r = Number(attrs(rm[1]).r);
            if (r > MAX_ROW) break;
            (rm[2] || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, at, body) => {
              const c = attrs(at);
              const ref = /^([A-Z]+)(\d+)$/.exec(c.r || '');
              if (!ref) return m;
              if (c.s != null) styleOf[ref[0]] = Number(c.s);
              if (!body) return m;
              let v;
              if (c.t === 'inlineStr') v = texts(body);
              else {
                const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
                if (!vm) return m;
                v = c.t === 's' ? shared[Number(vm[1])] : unescape(vm[1]);
                if (!c.t || c.t === 'n') v = String(Number(v));
              }
              grid[ref[0]] = v;
              return m;
            });
          }
          const merges = [];
          sheet.replace(/<mergeCell\b[^>]*ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (m, c1, r1, c2, r2) => {
            merges.push({ c1: colNum(c1), r1: Number(r1), c2: colNum(c2), r2: Number(r2) });
            return m;
          });
          // The cell that holds what (c, r) shows: itself, or the top-left of its merge when it is empty.
          const holder = (c, r) => {
            const ref = colName(c) + r;
            if (grid[ref] != null && String(grid[ref]).trim() !== '') return ref;
            const mg = merges.find((g) => c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2);
            return mg ? colName(mg.c1) + mg.r1 : ref;
          };
          const cell = (c, r) => String(grid[holder(c, r)] ?? '');
          const fill = (c, r) => {
            const s = styleOf[holder(c, r)];
            return s == null ? '' : fills[xfFill[s]] || '';
          };
          return { grid, cell, fill };
        };
        return { sheet, colName, colNum };
      };
      // ---- fin lector .xlsx ----

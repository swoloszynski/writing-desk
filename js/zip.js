// A zip writer, ported from the one in the typewriter project and turned
// into a module.
//
// Written by hand for the same reason as everything else here: a zip holding
// files that are already compressed needs no compression of its own. A PDF is
// a compressed format, so deflating it again buys almost nothing, and the
// "stored" method is only a container — a header per file, the bytes verbatim,
// and a directory at the end saying where each one starts.
//
// The one piece with any substance is CRC-32, which every entry carries twice
// and which unzip checks before it will extract anything.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS packed date and time: seconds in two-second steps, and years counted
// from 1980. A format older than most of the files it is asked to carry.
function dosStamp(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const nameBytes = name => new TextEncoder().encode(name);

/**
 * @param {{name: string, bytes: Uint8Array}[]} files
 * @returns {Blob}
 */
export function zip(files) {
  const now = dosStamp(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = nameBytes(file.name);
    const data = file.bytes;
    const crc = crc32(data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);   // local file header
    header.setUint16(4, 20, true);           // version needed
    header.setUint16(6, 0, true);            // flags
    header.setUint16(8, 0, true);            // method: stored
    header.setUint16(10, now.time, true);
    header.setUint16(12, now.date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true); // compressed size
    header.setUint32(22, data.length, true); // uncompressed size
    header.setUint16(26, name.length, true);
    header.setUint16(28, 0, true);           // extra length

    parts.push(new Uint8Array(header.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);      // central directory header
    dir.setUint16(4, 20, true);              // version made by
    dir.setUint16(6, 20, true);              // version needed
    dir.setUint16(8, 0, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, now.time, true);
    dir.setUint16(14, now.date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true);              // extra
    dir.setUint16(32, 0, true);              // comment
    dir.setUint16(34, 0, true);              // disk number
    dir.setUint16(36, 0, true);              // internal attrs
    dir.setUint32(38, 0, true);              // external attrs
    dir.setUint32(42, offset, true);         // where its local header is

    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);        // end of central directory
  end.setUint16(4, 0, true);                 // this disk
  end.setUint16(6, 0, true);                 // disk with the directory
  end.setUint16(8, files.length, true);      // entries on this disk
  end.setUint16(10, files.length, true);     // entries in total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);           // where the directory starts
  end.setUint16(20, 0, true);                // comment length

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
                  { type: 'application/zip' });
}

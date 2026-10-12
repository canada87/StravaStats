// js/shared/utils/zip.js
// Minimal ZIP writer (no compression, "stored" entries) so several GPX files can be handed to
// the user as one download without pulling in a dependency. GPX is small text and every unzip
// tool reads stored entries fine.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

/**
 * @param {{name: string, content: string}[]} files  UTF-8 text files; names must be unique.
 * @returns {Blob} application/zip
 */
export function buildZip(files) {
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const data = encoder.encode(file.content);
        const crc = crc32(data);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);   // local file header signature
        local.setUint16(4, 20, true);           // version needed
        local.setUint16(6, 0x0800, true);       // flags: UTF-8 file names
        local.setUint16(8, 0, true);            // method: stored
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true); // compressed size
        local.setUint32(22, data.length, true); // uncompressed size
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);           // extra field length
        localParts.push(local.buffer, nameBytes, data);

        const central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014B50, true); // central directory signature
        central.setUint16(4, 20, true);         // version made by
        central.setUint16(6, 20, true);         // version needed
        central.setUint16(8, 0x0800, true);
        central.setUint16(10, 0, true);
        central.setUint16(12, time, true);
        central.setUint16(14, day, true);
        central.setUint32(16, crc, true);
        central.setUint32(20, data.length, true);
        central.setUint32(24, data.length, true);
        central.setUint16(28, nameBytes.length, true);
        central.setUint32(42, offset, true);    // offset of local header
        centralParts.push(central.buffer, nameBytes);

        offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + (part.byteLength ?? part.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);         // end of central directory signature
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...localParts, ...centralParts, end.buffer], { type: 'application/zip' });
}

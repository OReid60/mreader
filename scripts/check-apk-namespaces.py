"""Reject host classes in the default package used by independently obfuscated APKs."""
import struct
import sys
import zipfile


def classes(dex):
    strings, types, count, definitions = (struct.unpack_from('<I', dex, offset)[0]
                                          for offset in (60, 68, 96, 100))
    for index in range(count):
        type_id = struct.unpack_from('<I', dex, definitions + index * 32)[0]
        string_id = struct.unpack_from('<I', dex, types + type_id * 4)[0]
        offset = struct.unpack_from('<I', dex, strings + string_id * 4)[0]
        while dex[offset] & 128:
            offset += 1
        offset += 1
        yield dex[offset:dex.index(0, offset)].decode('utf-8')


def check(path):
    found = []
    descriptors = set()
    total = 0
    with zipfile.ZipFile(path) as apk:
        for name in apk.namelist():
            if name.startswith('classes') and name.endswith('.dex'):
                for descriptor in classes(apk.read(name)):
                    descriptors.add(descriptor)
                    total += 1
                    if descriptor.startswith('L') and '/' not in descriptor:
                        found.append(descriptor)
    if found:
        raise SystemExit(f'FAIL: {len(found)} host classes may shadow extension classes: {found[:12]}')
    # zstd JNI looks up both interfaces and implementations during initialization;
    # unused compression classes must survive shrinking in a decompression-only app.
    required = {f'Lcom/squareup/zstd/{name};' for name in
                ('ZstdCompressor', 'ZstdDecompressor', 'JniZstdCompressor',
                 'JniZstdDecompressor', 'JniZstdKt')}
    missing = sorted(required - descriptors)
    if missing:
        raise SystemExit(f'FAIL: required zstd JNI classes were removed or renamed: {missing}')
    print(f'PASS: {total} host classes checked; no default-package extension collisions')
    print('PASS: zstd JNI compressor/decompressor classes retain their original names')


if __name__ == '__main__':
    check(sys.argv[1])

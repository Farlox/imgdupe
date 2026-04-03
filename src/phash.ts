import sharp from 'sharp';

const SIZE = 32;       // resize target for DCT input
const HASH_SIZE = 8;   // use top-left 8x8 of DCT (64 bits, minus DC = 63 bits)

// 1-D DCT-II
function dct1d(signal: number[]): number[] {
  const N = signal.length;
  return Array.from({ length: N }, (_, k) => {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
    }
    return sum;
  });
}

// 2-D DCT: apply 1-D DCT to rows then columns
function dct2d(matrix: number[][]): number[][] {
  const rowDct = matrix.map(dct1d);
  const result: number[][] = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  for (let col = 0; col < SIZE; col++) {
    const column = rowDct.map((row) => row[col]);
    const colDct = dct1d(column);
    for (let row = 0; row < SIZE; row++) {
      result[row][col] = colDct[row];
    }
  }
  return result;
}

/**
 * Compute a 63-bit perceptual hash (pHash) for an image file.
 * Uses DCT of a 32×32 grayscale thumbnail; takes the top-left 8×8
 * coefficients (excluding DC), thresholds at the median.
 */
export async function phashFile(filePath: string): Promise<bigint> {
  const raw = await sharp(filePath)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  const matrix: number[][] = Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => raw[row * SIZE + col])
  );

  const dct = dct2d(matrix);

  // Flatten top-left HASH_SIZE×HASH_SIZE, skipping DC at [0][0]
  const coeffs: number[] = [];
  for (let r = 0; r < HASH_SIZE; r++) {
    for (let c = 0; c < HASH_SIZE; c++) {
      if (r === 0 && c === 0) continue;
      coeffs.push(dct[r][c]);
    }
  }

  const avg = coeffs.reduce((a, b) => a + b, 0) / coeffs.length;

  let hash = 0n;
  for (let i = 0; i < coeffs.length; i++) {
    if (coeffs[i] > avg) hash |= 1n << BigInt(i);
  }
  return hash;
}

/** Number of differing bits between two pHashes (0 = identical, 63 = opposite). */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let dist = 0;
  while (xor !== 0n) {
    xor &= xor - 1n; // clear lowest set bit
    dist++;
  }
  return dist;
}

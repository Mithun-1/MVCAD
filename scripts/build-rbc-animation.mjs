import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// Keep the populated part of the supplied clip so cells are visible immediately,
// even during a fast rebuild. Remove the white matte before resizing the strip.
const unmatte = (channel) => `if(gt(alpha(X,Y),0),max(0,255+(${channel}(X,Y)-255)*255/alpha(X,Y)),0)`;
const filter = [
  'crop=960:112:120:868',
  'format=rgba',
  'colorkey=0xffffff:0.2:0.15',
  `geq=r='${unmatte('r')}':g='${unmatte('g')}':b='${unmatte('b')}':a='alpha(X,Y)'`,
  'scale=640:75:flags=lanczos',
].join(',');
mkdirSync('src/assets', { recursive: true });
for (const output of [
  [
    '-c:v',
    'libwebp_anim',
    '-quality',
    '82',
    '-compression_level',
    '6',
    '-loop',
    '0',
    'src/assets/regenerating-rbc.webp',
  ],
  ['-frames:v', '1', 'src/assets/regenerating-rbc-still.png'],
]) {
  const result = spawnSync(
    process.env.FFMPEG || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '0.55',
      '-t',
      '0.55',
      '-i',
      'Media/RegenAnimation.mp4',
      '-vf',
      filter,
      '-an',
      ...output,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

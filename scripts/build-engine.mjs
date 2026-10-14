import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Use EMXX=em++ with an activated Emscripten SDK, or ZIG=/path/to/zig.
// A portable Zig install under .tools is also detected. Zig's C++ frontend is Clang.
mkdirSync('engine', { recursive: true });
const exports = [
  'kernel_version',
  'plane_capacity',
  'plane_count',
  'reset_model',
  'create_offset_plane',
  'plane_data',
  'point_buffer',
  'validate_points',
  'curve_modes',
  'curve_data',
  'evaluate_curve',
];
let command, args;
if (process.env.EMXX) {
  command = process.env.EMXX;
  args = [
    'engine/planes.cpp',
    '-O3',
    '-std=c++17',
    '-fno-exceptions',
    '-fno-rtti',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    '-sFILESYSTEM=0',
    '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports.map((x) => '_' + x)),
    '-o',
    'engine/planes.wasm',
  ];
} else {
  const local =
    existsSync('.tools') &&
    readdirSync('.tools').find(
      (x) =>
        x.startsWith('zig-') &&
        existsSync(join('.tools', x, process.platform === 'win32' ? 'zig.exe' : 'zig')),
    );
  command =
    process.env.ZIG ||
    (local ? resolve('.tools', local, process.platform === 'win32' ? 'zig.exe' : 'zig') : 'zig');
  args = [
    'c++',
    'engine/planes.cpp',
    '-target',
    'wasm32-freestanding',
    '-O3',
    '-std=c++17',
    '-nostdlib',
    '-fno-exceptions',
    '-fno-rtti',
    '-Wl,--no-entry',
    '-Wl,--export-memory',
    ...exports.map((x) => '-Wl,--export=' + x),
    '-o',
    'engine/planes.wasm',
  ];
}
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32' && /\.(bat|cmd)$/.test(command),
  env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: resolve('.tools/zig-cache') },
});
if (result.error)
  console.error('Install Zig or activate Emscripten and set EMXX=em++.\n' + result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);
const sweepExports = [
  'sweep_settings',
  'sweep_segments',
  'sweep_vertices',
  'sweep_normals',
  'sweep_sources',
  'sweep_caps',
  'finish_sweep',
  'sweep_mesh_creases',
  'sweep_mesh_crease_ranges',
  'index_sweep',
  'sweep_mesh_counts',
  'sweep_mesh_indices',
  'sweep_mesh_render_indices',
  'sweep_mesh_sources',
  'sweep_mesh_caps',
  'sweep_mesh_ranges',
  'sweep_mesh_normals',
  'sweep_mesh_render_positions',
  'sweep_field',
  'sweep_roundings',
  'build_sweep',
  'build_sweep_slice',
  'assemble_sweep',
  'begin_merge_sweep',
  'merge_sweep_chunk',
  'finish_merge_sweep',
  'sweep_merge_indices',
  'sweep_merge_render_indices',
  'sweep_mesh_render_vertices',
  'prepare_sweep',
  'polygonize_sweep',
];
const sweepArgs = args
  .filter((arg) => !arg.startsWith('-Wl,--export=') && !arg.startsWith('-sEXPORTED_FUNCTIONS='))
  .map((arg) =>
    arg.replace('engine/planes.cpp', 'engine/sweep.cpp').replace('engine/planes.wasm', 'engine/sweep.wasm'),
  );
sweepArgs.push(
  ...(process.env.EMXX
    ? [
        '-sINITIAL_MEMORY=1073741824',
        '-sSTACK_SIZE=8388608',
        '-sEXPORTED_FUNCTIONS=' + JSON.stringify(sweepExports.map((x) => '_' + x)),
      ]
    : ['-Wl,-z,stack-size=8388608', ...sweepExports.map((x) => '-Wl,--export=' + x)]),
);
const sweepResult = spawnSync(command, sweepArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32' && /\.(bat|cmd)$/.test(command),
  env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: resolve('.tools/zig-cache') },
});
process.exit(sweepResult.status ?? 1);

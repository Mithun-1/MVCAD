// MVCAD reference geometry kernel. Dimensionless, right-handed, Y-up.
// Freestanding C++17: no runtime, allocator, OS APIs, or JavaScript imports.
// ABI frame layout: origin.xyz, u.xyz, v.xyz, normal.xyz (12 float64 values).
namespace {
// 3 principal + 4093 document planes + one temporary live-preview plane.
constexpr int capacity = 4097;
constexpr double max_offset = 1000000.0;
struct Plane { double frame[12]; };
Plane planes[capacity];
int count = 0;
constexpr int max_points = 100000;
double point_coordinates[max_points * 3];
constexpr int max_curve_points = 1000;
int curve_connections[max_curve_points];
double curve_coordinates[(max_curve_points * 24 + 1) * 3];
}

extern "C" {
int kernel_version() { return 1; }
int plane_capacity() { return capacity; }
int plane_count() { return count; }
double* point_buffer() { return point_coordinates; }
int* curve_modes() { return curve_connections; }
double* curve_data() { return curve_coordinates; }
// Interpolating cubic Hermite spline runs; straight segments break tangent continuity.
// Input coordinates share point_buffer; each mode is the incoming segment (0=line, 1=spline).
int evaluate_curve(int size) {
    if (size < 2 || size > max_curve_points) return -1;
    for (int i = 0; i < size; ++i) {
        if (curve_connections[i] != 0 && curve_connections[i] != 1) return -2;
        for (int c = 0; c < 3; ++c)
            if (!__builtin_isfinite(point_coordinates[i * 3 + c])) return -3;
    }
    int output = 1;
    for (int c = 0; c < 3; ++c) curve_coordinates[c] = point_coordinates[c];
    for (int i = 1; i < size; ++i) {
        const bool spline = curve_connections[i] == 1;
        const int steps = spline ? 24 : 1;
        for (int step = 1; step <= steps; ++step) {
            const double t = double(step) / steps, t2 = t*t, t3 = t2*t;
            for (int c = 0; c < 3; ++c) {
                const double a = point_coordinates[(i-1)*3+c], b = point_coordinates[i*3+c];
                const double ma = i > 1 && curve_connections[i-1] == 1 ? (b - point_coordinates[(i-2)*3+c])*0.5 : b-a;
                const double mb = i+1 < size && curve_connections[i+1] == 1 ? (point_coordinates[(i+1)*3+c]-a)*0.5 : b-a;
                curve_coordinates[output*3+c] = step == steps ? b :
                    ((2*t3-3*t2+1)*a + (t3-2*t2+t)*ma + (-2*t3+3*t2)*b + (t3-t2)*mb);
            }
            ++output;
        }
    }
    return output;
}
// Cartesian coordinates relative to world origin already are world coordinates.
// Validate the packed float64 buffer before exposing it to the renderer.
int validate_points(int size) {
    if (size < 0 || size > max_points) return -1;
    for (int i = 0; i < size * 3; ++i)
        if (!__builtin_isfinite(point_coordinates[i]) || point_coordinates[i] < -max_offset || point_coordinates[i] > max_offset)
            return i / 3 + 1;
    return 0;
}

void reset_model() {
    // Front XY (+Z); Top XZ (+Y); Right YZ (+X).
    const double basis[3][12] = {
        {0,0,0, 1,0,0, 0,1,0, 0,0,1},
        {0,0,0, 1,0,0, 0,0,-1, 0,1,0},
        {0,0,0, 0,0,-1, 0,1,0, 1,0,0}
    };
    for (int p = 0; p < 3; ++p)
        for (int c = 0; c < 12; ++c) planes[p].frame[c] = basis[p][c];
    count = 3;
}

// Returns a handle, or -1 invalid parent, -2 invalid distance, -3 full.
int create_offset_plane(int parent, double distance) {
    if (parent < 0 || parent >= count) return -1;
    if (!__builtin_isfinite(distance) || distance < -max_offset || distance > max_offset) return -2;
    if (count >= capacity) return -3;
    Plane& result = planes[count];
    const Plane& source = planes[parent];
    for (int c = 0; c < 12; ++c) result.frame[c] = source.frame[c];
    for (int c = 0; c < 3; ++c) result.frame[c] += distance * source.frame[9 + c];
    return count++;
}

const double* plane_data(int handle) {
    return handle >= 0 && handle < count ? planes[handle].frame : nullptr;
}
}

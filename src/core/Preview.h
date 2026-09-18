#pragma once
#include "Network.h"

namespace mvcad {
struct Triangle { Vec3 a,b,c; int branch=-1; };
struct Preview {
    std::vector<std::vector<Vec3>> centerlines;
    std::vector<Triangle> triangles;
};
std::vector<Vec3> interpolateCurve(const std::vector<Vec3>& points,int steps=12);
std::vector<Vec3> trimByArcLength(const std::vector<Vec3>& points,double start,double end);
Preview makePreview(const Network& n);
}

#pragma once
#include "core/Network.h"

inline mvcad::Vec3 unitTriangleNormal(mvcad::Vec3 a,mvcad::Vec3 b,mvcad::Vec3 c) {
    // Qt's float-vector fuzzy normalization treats small valid face areas as
    // zero. Normalize in double precision before converting for display.
    const auto normal=(b-a).cross(c-a);
    const double length=normal.length();
    return length>0?normal/length:mvcad::Vec3{};
}

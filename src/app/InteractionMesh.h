#pragma once
#include "core/Preview.h"
#include <unordered_set>
#include <array>
#include <cstdint>
#include <algorithm>
#include <cmath>

// Temporary display mesh only. The exact B-rep and requested fine mesh remain
// untouched and are restored as soon as camera interaction ends.
inline std::vector<mvcad::Triangle> interactionMesh(const std::vector<mvcad::Triangle>& input){
    if(input.size()<30000)return input;
    mvcad::Vec3 lo=input.front().a,hi=lo;
    for(const auto& t:input)for(auto p:{t.a,t.b,t.c}){lo.x=std::min(lo.x,p.x);lo.y=std::min(lo.y,p.y);lo.z=std::min(lo.z,p.z);hi.x=std::max(hi.x,p.x);hi.y=std::max(hi.y,p.y);hi.z=std::max(hi.z,p.z);}
    const double cell=(hi-lo).length()/400.;if(!(cell>0)||!std::isfinite(cell))return input;
    struct Face{std::array<uint64_t,3> vertices;int branch;bool operator==(const Face&)const=default;};
    struct Hash{size_t operator()(const Face& f)const{return size_t(f.vertices[0]*73856093ULL^f.vertices[1]*19349663ULL^f.vertices[2]*83492791ULL^uint64_t(f.branch));}};
    std::unordered_set<Face,Hash> faces;std::vector<mvcad::Triangle> result;result.reserve(std::min<size_t>(input.size(),100000));
    auto snap=[&](mvcad::Vec3& p){p=(p-lo)/cell;const uint64_t x=uint64_t(std::max(0.,std::round(p.x))),y=uint64_t(std::max(0.,std::round(p.y))),z=uint64_t(std::max(0.,std::round(p.z)));p=lo+mvcad::Vec3{double(x),double(y),double(z)}*cell;return (x<<40)|(y<<20)|z;};
    for(auto t:input){Face face{{snap(t.a),snap(t.b),snap(t.c)},t.branch};
        if(face.vertices[0]==face.vertices[1]||face.vertices[1]==face.vertices[2]||face.vertices[0]==face.vertices[2])continue;
        // Canonical cyclic order preserves winding. Thin opposite faces can
        // collapse onto the same grid plane and must remain visible both ways.
        const auto first=std::min_element(face.vertices.begin(),face.vertices.end());
        std::rotate(face.vertices.begin(),first,face.vertices.end());
        if(faces.insert(face).second)result.push_back(t);
    }
    return result;
}

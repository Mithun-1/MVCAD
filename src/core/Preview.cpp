#include "Preview.h"
#include <algorithm>
#include <array>
#include <numbers>
#include <stdexcept>

namespace mvcad {
static void fail(const char* message) { throw std::runtime_error(message); }

static Vec3 checkedMix(Vec3 x,Vec3 y,double tx,double ty,double t) {
    const double u=(t-tx)/(ty-tx);
    const auto result=x+(y-x)*u;
    if(!result.finite()) fail("Centerline interpolation exceeded the supported numeric range.");
    return result;
}

std::vector<Vec3> interpolateCurve(const std::vector<Vec3>& p,int steps) {
    for(auto point:p) if(!point.finite()) fail("Centerline points must be finite.");
    if(p.size()<2 || steps<1) return p;
    std::vector<Vec3> out;
    // Centripetal Catmull-Rom, with reflected endpoint controls. This is display
    // geometry, not a boundary representation or a promise of sweep validity.
    for(size_t i=0;i+1<p.size();++i) {
        const auto b=p[i],c=p[i+1];
        auto a=i?p[i-1]:b+(b-c);
        auto d=i+2<p.size()?p[i+2]:c+(c-b);
        // Reflection can overflow at the edge of the double range. Repeating the
        // endpoint is a safe display-only fallback for that exceptional input.
        if(!a.finite()) a=b;
        if(!d.finite()) d=c;
        auto dt=[](Vec3 x,Vec3 y){
            const auto distance=(y-x).length();
            if(!std::isfinite(distance)) fail("Centerline span exceeds the supported numeric range.");
            return std::max(1e-9,std::sqrt(distance));
        };
        const double t0=0,t1=dt(a,b),t2=t1+dt(b,c),t3=t2+dt(c,d);
        for(int k=0;k<steps;++k) {
            const double t=t1+(t2-t1)*k/steps;
            auto a1=checkedMix(a,b,t0,t1,t),a2=checkedMix(b,c,t1,t2,t),a3=checkedMix(c,d,t2,t3,t);
            out.push_back(checkedMix(checkedMix(a1,a2,t0,t2,t),checkedMix(a2,a3,t1,t3,t),t1,t2,t));
        }
    }
    out.push_back(p.back());return out;
}
std::vector<Vec3> trimByArcLength(const std::vector<Vec3>& p,double start,double end) {
    if(!std::isfinite(start)||!std::isfinite(end)||start<0||end<0||start+end>=1)
        fail("Invalid arc-length trim.");
    for(auto point:p) if(!point.finite()) fail("Centerline points must be finite.");
    if(p.size()<2) return p;
    std::vector<double> lengths(p.size());
    for(size_t i=1;i<p.size();++i) {
        const auto segment=(p[i]-p[i-1]).length();
        lengths[i]=lengths[i-1]+segment;
        if(!std::isfinite(segment)||!std::isfinite(lengths[i])) fail("Centerline length exceeds the supported numeric range.");
    }
    if(!(lengths.back()>0)) fail("Cannot trim a zero-length centerline.");
    const double a=lengths.back()*start,b=lengths.back()*(1-end);
    if(!(a<b)) fail("Arc-length trim leaves no representable centerline length.");
    auto at=[&](double t){
        const auto it=std::lower_bound(lengths.begin(),lengths.end(),t);
        if(it==lengths.begin()) return p.front();
        if(it==lengths.end()) return p.back();
        const auto i=static_cast<size_t>(it-lengths.begin());
        const auto span=lengths[i]-lengths[i-1];
        return span>1e-15?p[i-1]+(p[i]-p[i-1])*((t-lengths[i-1])/span):p[i];
    };
    std::vector<Vec3> out{at(a)};
    for(size_t i=1;i+1<p.size();++i) if(lengths[i]>a&&lengths[i]<b) out.push_back(p[i]);
    out.push_back(at(b));return out;
}
Preview makePreview(const Network& n,double precision) {
    if(!std::isfinite(precision)||precision<1e-4||precision>1) fail("Display precision must be between 1e-4 and 1.");
    Preview mesh;
    for(int index=0;index<static_cast<int>(n.branches.size());++index) {
        const auto& b=n.branches[index];
        if(b.start<0||b.end<0||b.start>=static_cast<int>(n.nodes.size())||b.end>=static_cast<int>(n.nodes.size()))
            fail("Branch endpoint index is invalid.");
        if(b.points.size()<2) fail("A preview branch requires at least two points.");
        if(!std::isfinite(b.diameter)||b.diameter<0) fail("Branch diameter must be nonnegative and finite.");
        const int steps=std::max(1,std::min(12,512/static_cast<int>(b.points.size())));
        auto full=interpolateCurve(b.points,steps);mesh.centerlines.push_back(full);
        if(b.diameter<=0) continue;
        const double halfAngle=std::acos(std::clamp(1-precision/(b.diameter/2),-1.0,1.0));
        if(!(halfAngle>0)||std::numbers::pi/halfAngle>4096)fail("Diameter is too large for this display precision. Increase tolerance or reduce diameter.");
        const int sides=std::max(16,static_cast<int>(std::ceil(std::numbers::pi/halfAngle)));
        auto p=trimByArcLength(full,n.nodes[b.start].degree>2?b.startSetback:0,n.nodes[b.end].degree>2?b.endSetback:0);
        if(mesh.triangles.size()+p.size()*sides*2>2000000)fail("Preview exceeds two million triangles. Increase display tolerance or reduce input size.");
        std::vector<std::vector<Vec3>> rings;
        Vec3 normal;
        for(size_t i=0;i<p.size();++i) {
            const Vec3 tangent=(p[std::min(i+1,p.size()-1)]-p[i?i-1:0]).normalized();
            if(i==0) normal=tangent.cross(std::abs(tangent.z)<.9?Vec3{0,0,1}:Vec3{0,1,0}).normalized();
            else {
                normal=normal-tangent*normal.dot(tangent);
                if(normal.length()<1e-8) normal=tangent.cross(std::abs(tangent.z)<.9?Vec3{0,0,1}:Vec3{0,1,0});
                normal=normal.normalized();
            }
            const auto binormal=tangent.cross(normal).normalized();
            std::vector<Vec3> ring(sides);
            for(int s=0;s<sides;++s) {
                const double angle=2*std::numbers::pi*s/sides;
                ring[s]=p[i]+(normal*std::cos(angle)+binormal*std::sin(angle))*(b.diameter/2);
                if(!ring[s].finite()) fail("Sweep preview exceeded the supported numeric range.");
            }
            rings.push_back(ring);
        }
        for(size_t i=1;i<rings.size();++i) for(int s=0;s<sides;++s) {
            const int z=(s+1)%sides;
            mesh.triangles.push_back({rings[i-1][s],rings[i][z],rings[i][s],index});
            mesh.triangles.push_back({rings[i-1][s],rings[i-1][z],rings[i][z],index});
        }
        for(int s=0;s<sides;++s) {
            const int z=(s+1)%sides;
            mesh.triangles.push_back({p.front(),rings.front()[z],rings.front()[s],index});
            mesh.triangles.push_back({p.back(),rings.back()[s],rings.back()[z],index});
        }
    }
    return mesh;
}
}

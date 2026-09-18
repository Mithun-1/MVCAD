#pragma once
#include <QString>
#include <QByteArray>
#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace mvcad {
struct Vec3 {
    double x = 0, y = 0, z = 0;
    Vec3 operator+(Vec3 b) const { return {x+b.x,y+b.y,z+b.z}; }
    Vec3 operator-(Vec3 b) const { return {x-b.x,y-b.y,z-b.z}; }
    Vec3 operator*(double a) const { return {x*a,y*a,z*a}; }
    Vec3 operator/(double a) const { return *this * (1.0/a); }
    double dot(Vec3 b) const { return x*b.x+y*b.y+z*b.z; }
    Vec3 cross(Vec3 b) const { return {y*b.z-z*b.y,z*b.x-x*b.z,x*b.y-y*b.x}; }
    double length() const {
        if(std::isnan(x)||std::isnan(y)||std::isnan(z))
            return std::numeric_limits<double>::quiet_NaN();
        if(std::isinf(x)||std::isinf(y)||std::isinf(z))
            return std::numeric_limits<double>::infinity();
        const auto scale=std::max({std::abs(x),std::abs(y),std::abs(z)});
        if(scale==0) return 0;
        const auto sx=x/scale,sy=y/scale,sz=z/scale;
        return scale*std::sqrt(sx*sx+sy*sy+sz*sz);
    }
    Vec3 normalized() const {
        if(!finite()) return {1,0,0};
        const auto scale=std::max({std::abs(x),std::abs(y),std::abs(z)});
        if(!(scale>0)) return {1,0,0};
        const auto scaled=*this/scale;
        return scaled/scaled.length();
    }
    bool finite() const { return std::isfinite(x)&&std::isfinite(y)&&std::isfinite(z); }
};
struct Curve { QString id; std::vector<Vec3> points; };
struct Node { Vec3 point; int degree=0; };
struct Branch {
    QString id;
    std::vector<Vec3> points;
    int start=0, end=0;
    double diameter=0; // Zero denotes unassigned, never a zero-diameter solid.
    double startSetback=0.1, endSetback=0.1;
};
struct Network {
    std::vector<Curve> curves;
    std::vector<Node> nodes;
    std::vector<Branch> branches;
    double tolerance=1e-6;
    int components=0;
};
struct JunctionState { int node=0, assigned=0, incident=0; };
std::vector<Curve> parseCsv(const QByteArray& data);
Network buildNetwork(const std::vector<Curve>& curves, double tolerance=1e-6);
void setBranchParameters(Network& network, int branch, double diameter, double start, double end);
std::vector<JunctionState> junctionStates(const Network& network);
Network demoNetwork();
} // namespace mvcad

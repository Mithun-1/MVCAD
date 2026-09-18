#pragma once

#include "core/Preview.h"
#include <QPointF>
#include <QString>
#include <memory>
#include <vector>

namespace mvcad {

enum class Plane { Front, Top, Right };
enum class ProfileType { Circle, Rectangle, Polyline };
enum class CadOperation { Boss, Cut };
enum class CadExtent { Blind, ThroughAll, MidPlane };

struct Sketch {
    QString id;
    Plane plane = Plane::Front;
    double offset = 0;
    ProfileType profile = ProfileType::Circle;
    // Circle: one center point plus radius. Rectangle: two opposite corners.
    // Polyline: at least three vertices; closure is implicit.
    std::vector<QPointF> points;
    double radius = 0;
};

struct CadFeature {
    QString id;
    int sketch = -1;
    CadOperation operation = CadOperation::Boss;
    CadExtent extent = CadExtent::Blind;
    double depth = 1;
    bool reversed = false;
};

struct CadModel {
    std::vector<Sketch> sketches;
    std::vector<CadFeature> features;
};

struct CadResult {
    std::vector<Triangle> triangles;
    double volume = 0;
    // Owns an immutable TopoDS_Shape without exposing OCCT in this public header.
    std::shared_ptr<const void> nativeShape;
};

enum class VesselBuildState { Built, Provisional, Failed };

struct VesselItemResult {
    int index = -1;
    VesselBuildState state = VesselBuildState::Provisional;
    QString message;
    // Successful guided junctions expose validation evidence for diagnostics.
    double maximumSeamAngle = -1;
    std::vector<Vec3> guide;
};

struct VesselResult {
    std::vector<Triangle> triangles;
    double volume = 0;
    std::shared_ptr<const void> nativeShape;
    std::vector<VesselItemResult> branches;
    std::vector<VesselItemResult> junctions;
    std::vector<std::vector<Vec3>> centerlines;
};

Vec3 planePoint(Plane plane,QPointF point,double offset=0);
Vec3 planeNormal(Plane plane);
Network addCenterlineWithSplineConnections(const Network& previous,const Curve& curve);
CadResult buildCad(const CadModel& model,double deflection=1e-3);
VesselResult buildVessels(const Network& network,double deflection=1e-3,double junctionRadius=0);

} // namespace mvcad

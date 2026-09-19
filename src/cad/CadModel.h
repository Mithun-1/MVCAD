#pragma once

#include "core/Preview.h"
#include <QPointF>
#include <QString>
#include <memory>
#include <vector>

namespace mvcad {

enum class Plane { Front, Top, Right };
enum class ProfileType { Circle, Rectangle, Polyline };
enum class CadOperation { Boss, Cut, Fillet, DeleteBody };
enum class CadExtent { Blind, ThroughAll, MidPlane, TwoDirections };
enum class CadBodyMode { Merge, NewBody };

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
    double secondDepth = 0;
    double startOffset = 0;
    CadBodyMode bodyMode = CadBodyMode::Merge;
    QString targetBody;
    double filletRadius = 0;
    std::vector<QString> edgeIds;
};

struct CadModel {
    std::vector<Sketch> sketches;
    std::vector<CadFeature> features;
};

struct CadEdgeResult {
    QString id;
    QString bodyId;
    std::vector<Vec3> polyline;
    double length = 0;
};

struct CadBodyResult {
    QString id;
    std::vector<Triangle> triangles;
    std::vector<CadEdgeResult> edges;
    double volume = 0;
    std::shared_ptr<const void> nativeShape;
};

struct CadResult {
    // Aggregate fields are retained for existing renderers and exporters.
    std::vector<Triangle> triangles;
    double volume = 0;
    std::shared_ptr<const void> nativeShape;
    std::vector<CadBodyResult> bodies;
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
    QString bodyId = "vessels";
};

Vec3 planePoint(Plane plane,QPointF point,double offset=0);
Vec3 planeNormal(Plane plane);
Network connectCenterlinesWithSplineConnections(const std::vector<Curve>& curves,double tolerance=1e-6);
Network addCenterlineWithSplineConnections(const Network& previous,const Curve& curve);
CadResult buildCad(const CadModel& model,double deflection=1e-3);
VesselResult buildVessels(const Network& network,double deflection=1e-3,double junctionRadius=0);

} // namespace mvcad

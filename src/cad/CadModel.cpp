#include "CadModel.h"
#include "core/PointWorkflow.h"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GC_MakeSegment.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomAdaptor_Curve.hxx>
#include <Geom_Curve.hxx>
#include <GeomLProp_SLProps.hxx>
#include <GeomFill_Trihedron.hxx>
#include <Poly_Triangulation.hxx>
#include <Precision.hxx>
#include <Law_Interpol.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <TColStd_HArray1OfReal.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

namespace mvcad {
namespace {

[[noreturn]] void fail(const QString& message) { throw std::runtime_error(message.toStdString()); }

bool finite(QPointF point) { return std::isfinite(point.x())&&std::isfinite(point.y()); }

gp_Dir direction(Vec3 value) { return {value.x,value.y,value.z}; }
gp_Vec vector(Vec3 value) { return {value.x,value.y,value.z}; }
gp_Pnt point(Vec3 value) { return {value.x,value.y,value.z}; }
Vec3 point(gp_Pnt value) { return {value.X(),value.Y(),value.Z()}; }

Vec3 planeXAxis(Plane plane) {
    switch(plane) {
    case Plane::Front: return {1,0,0};
    case Plane::Top: return {1,0,0};
    case Plane::Right: return {0,1,0};
    }
    fail("Unknown sketch plane.");
}

std::vector<QPointF> polygonPoints(const Sketch& sketch) {
    if(sketch.profile==ProfileType::Rectangle) {
        if(sketch.points.size()!=2) fail("A rectangle sketch requires two opposite corners.");
        const auto a=sketch.points[0],b=sketch.points[1];
        if(!finite(a)||!finite(b)) fail("Sketch coordinates must be finite.");
        if(std::abs(a.x()-b.x())<=Precision::Confusion()||std::abs(a.y()-b.y())<=Precision::Confusion())
            fail("Rectangle width and height must be nonzero.");
        const auto xmin=std::min(a.x(),b.x()),xmax=std::max(a.x(),b.x());
        const auto ymin=std::min(a.y(),b.y()),ymax=std::max(a.y(),b.y());
        return {{xmin,ymin},{xmax,ymin},{xmax,ymax},{xmin,ymax}};
    }
    if(sketch.points.size()<3) fail("A closed polyline sketch requires at least three vertices.");
    auto points=sketch.points;
    for(auto value:points) if(!finite(value)) fail("Sketch coordinates must be finite.");
    const auto closeDistance=std::hypot(points.front().x()-points.back().x(),points.front().y()-points.back().y());
    if(closeDistance<=Precision::Confusion()) points.pop_back();
    if(points.size()<3) fail("A closed polyline sketch requires at least three distinct vertices.");
    for(size_t i=0;i<points.size();++i) {
        const auto& a=points[i];const auto& b=points[(i+1)%points.size()];
        if(std::hypot(a.x()-b.x(),a.y()-b.y())<=Precision::Confusion())
            fail("A closed polyline cannot contain zero-length edges.");
    }
    double twiceArea=0;
    for(size_t i=0;i<points.size();++i) {
        const auto& a=points[i];const auto& b=points[(i+1)%points.size()];
        twiceArea+=a.x()*b.y()-a.y()*b.x();
    }
    if(!std::isfinite(twiceArea)||std::abs(twiceArea)<=2*Precision::Confusion()*Precision::Confusion())
        fail("A closed polyline must enclose a finite nonzero area.");
    if(twiceArea<0) std::reverse(points.begin(),points.end());
    return points;
}

TopoDS_Face profileFace(const Sketch& sketch) {
    if(sketch.id.isEmpty()) fail("Sketch identifiers must be nonempty.");
    if(!std::isfinite(sketch.offset)) fail("Sketch plane offset must be finite.");
    TopoDS_Wire wire;
    if(sketch.profile==ProfileType::Circle) {
        if(sketch.points.size()!=1||!finite(sketch.points.front()))
            fail("A circle sketch requires one finite center point.");
        if(!std::isfinite(sketch.radius)||sketch.radius<=Precision::Confusion())
            fail("Circle radius must be finite and greater than modeling precision.");
        const auto center=planePoint(sketch.plane,sketch.points.front(),sketch.offset);
        const gp_Ax2 axes(point(center),direction(planeNormal(sketch.plane)),direction(planeXAxis(sketch.plane)));
        BRepBuilderAPI_MakeEdge edge(gp_Circ(axes,sketch.radius));
        if(!edge.IsDone()) fail("Could not construct the circular sketch edge.");
        BRepBuilderAPI_MakeWire builder(edge.Edge());
        if(!builder.IsDone()) fail("Could not construct the circular sketch wire.");
        wire=builder.Wire();
    } else if(sketch.profile==ProfileType::Rectangle||sketch.profile==ProfileType::Polyline) {
        const auto points=polygonPoints(sketch);
        BRepBuilderAPI_MakePolygon builder;
        for(auto value:points) builder.Add(point(planePoint(sketch.plane,value,sketch.offset)));
        builder.Close();
        if(!builder.IsDone()) fail("Could not construct the closed sketch wire.");
        wire=builder.Wire();
    } else fail("Unknown sketch profile type.");
    BRepBuilderAPI_MakeFace builder(wire,true);
    if(!builder.IsDone()) fail("Sketch profile does not form a planar face.");
    auto face=builder.Face();
    if(!BRepCheck_Analyzer(face).IsValid()) fail("Sketch profile is invalid or self-intersecting.");
    GProp_GProps properties;BRepGProp::SurfaceProperties(face,properties);
    if(!std::isfinite(properties.Mass())||properties.Mass()<=Precision::Confusion()*Precision::Confusion())
        fail("Sketch profile has no usable enclosed area.");
    return face;
}

double volumeOf(const TopoDS_Shape& shape) {
    GProp_GProps properties;BRepGProp::VolumeProperties(shape,properties);
    return std::abs(properties.Mass());
}

double changeTolerance(double scale) {
    const auto confusion=Precision::Confusion();
    return std::max(confusion*confusion*confusion,std::abs(scale)*1e-12);
}

int solidCount(const TopoDS_Shape& shape) {
    int count=0;for(TopExp_Explorer explorer(shape,TopAbs_SOLID);explorer.More();explorer.Next()) ++count;
    return count;
}

struct OwnedFace { TopoDS_Shape face; int feature=-1; };

bool containsSame(const TopTools_ListOfShape& shapes,const TopoDS_Shape& candidate) {
    for(TopTools_ListIteratorOfListOfShape it(shapes);it.More();it.Next())
        if(it.Value().IsSame(candidate)) return true;
    return false;
}

bool descendsFrom(BRepAlgoAPI_BooleanOperation& operation,const TopoDS_Shape& source,
                  const TopoDS_Shape& candidate) {
    return source.IsSame(candidate)||containsSame(operation.Modified(source),candidate)
           ||containsSame(operation.Generated(source),candidate);
}

std::vector<OwnedFace> resultOwners(BRepAlgoAPI_BooleanOperation& operation,
                                    const TopoDS_Shape& result,const TopoDS_Shape& tool,
                                    const std::vector<OwnedFace>& previous,int feature) {
    std::vector<OwnedFace> owners;
    for(TopExp_Explorer explorer(result,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=explorer.Current();int owner=-1;
        // Tool descendants take priority so newly exposed cut walls and boss faces
        // select the feature that created them.
        for(TopExp_Explorer source(tool,TopAbs_FACE);source.More()&&owner<0;source.Next())
            if(descendsFrom(operation,source.Current(),face)) owner=feature;
        for(const auto& prior:previous) if(owner<0&&descendsFrom(operation,prior.face,face)) owner=prior.feature;
        owners.push_back({face,owner<0?feature:owner});
    }
    return owners;
}

TopoDS_Face translated(const TopoDS_Face& face,Vec3 displacement) {
    gp_Trsf transform;transform.SetTranslation(vector(displacement));
    BRepBuilderAPI_Transform operation(face,transform,true);
    if(!operation.IsDone()) fail("Could not position the extrusion profile.");
    return TopoDS::Face(operation.Shape());
}

double throughAllLength(const TopoDS_Shape& target,const Sketch& sketch,Vec3 extrusionDirection,double& startPad) {
    Bnd_Box box;BRepBndLib::Add(target,box);box.SetGap(0);
    if(box.IsVoid()||box.IsOpen()) fail("Cannot determine a finite target extent for Through All.");
    Standard_Real xmin,ymin,zmin,xmax,ymax,zmax;box.Get(xmin,ymin,zmin,xmax,ymax,zmax);
    const auto origin=planePoint(sketch.plane,{},sketch.offset);
    double maximum=-std::numeric_limits<double>::infinity();
    for(double x:{xmin,xmax}) for(double y:{ymin,ymax}) for(double z:{zmin,zmax})
        maximum=std::max(maximum,(Vec3{x,y,z}-origin).dot(extrusionDirection));
    const auto diagonal=(Vec3{xmax,ymax,zmax}-Vec3{xmin,ymin,zmin}).length();
    if(!std::isfinite(maximum)||!std::isfinite(diagonal)) fail("Target extent exceeds the supported numeric range.");
    startPad=std::max(Precision::Confusion()*100,std::max(1.0,diagonal)*1e-6);
    return std::max(startPad,maximum+2*startPad);
}

TopoDS_Shape prismFor(const Sketch& sketch,const CadFeature& feature,const TopoDS_Shape& target) {
    auto face=profileFace(sketch);
    auto extrusionDirection=planeNormal(sketch.plane);
    if(feature.reversed) extrusionDirection=extrusionDirection*-1;
    double length=feature.depth;
    if(feature.extent==CadExtent::ThroughAll) {
        if(feature.operation!=CadOperation::Cut||target.IsNull()) fail("Through All requires an existing body and a cut feature.");
        double startPad=0;length=throughAllLength(target,sketch,extrusionDirection,startPad);
        face=translated(face,extrusionDirection*-startPad);
    } else if(feature.extent==CadExtent::Blind||feature.extent==CadExtent::MidPlane) {
        if(!std::isfinite(feature.depth)||feature.depth<=Precision::Confusion())
            fail("Extrusion depth must be finite and greater than modeling precision.");
        if(feature.extent==CadExtent::MidPlane) face=translated(face,extrusionDirection*(-feature.depth/2));
    } else fail("Unknown extrusion extent.");
    BRepPrimAPI_MakePrism builder(face,vector(extrusionDirection*length),true,true);
    if(!builder.IsDone()) fail("Could not construct the extrusion prism.");
    auto prism=builder.Shape();
    if(!BRepCheck_Analyzer(prism).IsValid()||solidCount(prism)!=1) fail("Extrusion did not produce one valid solid.");
    const auto volume=volumeOf(prism);
    if(!std::isfinite(volume)||volume<=changeTolerance(volume)) fail("Extrusion produced no usable solid volume.");
    return prism;
}

TopoDS_Shape applyFeature(const TopoDS_Shape& current,const TopoDS_Shape& tool,const CadFeature& feature,
                          int featureIndex,std::vector<OwnedFace>& owners) {
    if(current.IsNull()) {
        if(feature.operation!=CadOperation::Boss) fail("The first CAD feature must create a body.");
        owners.clear();
        for(TopExp_Explorer explorer(tool,TopAbs_FACE);explorer.More();explorer.Next())
            owners.push_back({explorer.Current(),featureIndex});
        return tool;
    }
    const auto before=volumeOf(current);
    TopoDS_Shape result;
    TopTools_ListOfShape arguments,tools;arguments.Append(current);tools.Append(tool);
    if(feature.operation==CadOperation::Boss) {
        BRepAlgoAPI_Fuse operation;operation.SetArguments(arguments);operation.SetTools(tools);
        operation.SetNonDestructive(true);operation.Build();
        if(!operation.IsDone()||operation.HasErrors()) fail("Boss boolean operation failed.");
        result=operation.Shape();
        const auto after=volumeOf(result);
        if(after-before<=changeTolerance(before)||solidCount(result)!=1)
            fail("Boss must add connected material to the existing body.");
        owners=resultOwners(operation,result,tool,owners,featureIndex);
    } else {
        BRepAlgoAPI_Cut operation;operation.SetArguments(arguments);operation.SetTools(tools);
        operation.SetNonDestructive(true);operation.Build();
        if(!operation.IsDone()||operation.HasErrors()) fail("Cut boolean operation failed.");
        result=operation.Shape();
        const auto after=volumeOf(result);
        if(before-after<=changeTolerance(before)) fail("Cut does not intersect the existing body.");
        owners=resultOwners(operation,result,tool,owners,featureIndex);
    }
    if(result.IsNull()||solidCount(result)==0||!BRepCheck_Analyzer(result).IsValid())
        fail("CAD feature produced an invalid result.");
    return result;
}

std::vector<Triangle> meshShape(const TopoDS_Shape& source,double deflection,const std::vector<OwnedFace>& owners) {
    auto shape=source;BRepTools::Clean(shape);
    BRepMesh_IncrementalMesh mesher(shape,deflection,false,0.5,true);
    if(!mesher.IsDone()) fail("CAD tessellation failed.");
    std::vector<Triangle> triangles;
    for(TopExp_Explorer explorer(shape,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=TopoDS::Face(explorer.Current());TopLoc_Location location;
        int feature=-1;for(const auto& owner:owners) if(owner.face.IsSame(face)) {feature=owner.feature;break;}
        const auto mesh=BRep_Tool::Triangulation(face,location);
        if(mesh.IsNull()) fail("A CAD face could not be tessellated.");
        const auto transform=location.Transformation();
        for(Standard_Integer i=1;i<=mesh->NbTriangles();++i) {
            Standard_Integer a,b,c;mesh->Triangle(i).Get(a,b,c);
            if(face.Orientation()==TopAbs_REVERSED) std::swap(b,c);
            auto pa=mesh->Node(a).Transformed(transform),pb=mesh->Node(b).Transformed(transform),pc=mesh->Node(c).Transformed(transform);
            Triangle triangle{point(pa),point(pb),point(pc),feature};
            if(!triangle.a.finite()||!triangle.b.finite()||!triangle.c.finite()) fail("CAD tessellation exceeded the supported numeric range.");
            triangles.push_back(triangle);
        }
    }
    if(triangles.empty()) fail("CAD tessellation produced no triangles.");
    return triangles;
}

struct OwnedShape {
    TopoDS_Shape shape;
    std::vector<OwnedFace> owners;
    std::vector<TopoDS_Shape> sectionEdges;
    double maximumSeamAngle=-1;
    std::vector<Vec3> guide;
};

OwnedShape ownedShape(const TopoDS_Shape& shape,int owner) {
    OwnedShape result;result.shape=shape;
    for(TopExp_Explorer explorer(shape,TopAbs_FACE);explorer.More();explorer.Next())
        result.owners.push_back({explorer.Current(),owner});
    return result;
}

std::vector<OwnedFace> mergedOwners(BRepAlgoAPI_BooleanOperation& operation,const TopoDS_Shape& result,
                                    const std::vector<OwnedFace>& left,const std::vector<OwnedFace>& right) {
    std::vector<OwnedFace> owners;
    for(TopExp_Explorer explorer(result,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=explorer.Current();int owner=-1;bool found=false;
        for(const auto& source:right) if(!found&&descendsFrom(operation,source.face,face)) {owner=source.feature;found=true;}
        for(const auto& source:left) if(!found&&descendsFrom(operation,source.face,face)) {owner=source.feature;found=true;}
        if(!found) {
            const auto junction=std::find_if(right.begin(),right.end(),[](const auto& source){return source.feature<0;});
            if(junction!=right.end()) owner=junction->feature;
            else {
                const auto prior=std::find_if(left.begin(),left.end(),[](const auto& source){return source.feature<0;});
                if(prior!=left.end()) owner=prior->feature;
            }
        }
        owners.push_back({face,owner});
    }
    return owners;
}

std::vector<TopoDS_Shape> mergedSectionEdges(BRepAlgoAPI_BooleanOperation& operation,
                                             const std::vector<TopoDS_Shape>& previous) {
    std::vector<TopoDS_Shape> edges;
    auto append=[&](const TopoDS_Shape& edge) {
        if(edge.ShapeType()!=TopAbs_EDGE) return;
        bool belongs=false;
        for(TopExp_Explorer explorer(operation.Shape(),TopAbs_EDGE);explorer.More();explorer.Next())
            if(explorer.Current().IsSame(edge)) {belongs=true;break;}
        if(!belongs) return;
        if(std::none_of(edges.begin(),edges.end(),[&](const auto& other){return other.IsSame(edge);})) edges.push_back(edge);
    };
    for(const auto& edge:previous) {
        if(!operation.IsDeleted(edge)) append(edge);
        for(TopTools_ListIteratorOfListOfShape it(operation.Modified(edge));it.More();it.Next()) append(it.Value());
        for(TopTools_ListIteratorOfListOfShape it(operation.Generated(edge));it.More();it.Next()) append(it.Value());
    }
    for(TopTools_ListIteratorOfListOfShape it(operation.SectionEdges());it.More();it.Next()) append(it.Value());
    return edges;
}

OwnedShape fuseOwned(const OwnedShape& left,const OwnedShape& right) {
    TopTools_ListOfShape arguments,tools;arguments.Append(left.shape);tools.Append(right.shape);
    BRepAlgoAPI_Fuse operation;operation.SetArguments(arguments);operation.SetTools(tools);
    operation.SetNonDestructive(true);operation.Build();
    if(!operation.IsDone()||operation.HasErrors()) fail("Vessel junction boolean operation failed.");
    auto shape=operation.Shape();
    if(shape.IsNull()||solidCount(shape)==0||!BRepCheck_Analyzer(shape).IsValid())
        fail("Vessel junction boolean produced an invalid result.");
    OwnedShape result;result.shape=shape;
    result.owners=mergedOwners(operation,shape,left.owners,right.owners);
    auto prior=left.sectionEdges;prior.insert(prior.end(),right.sectionEdges.begin(),right.sectionEdges.end());
    result.sectionEdges=mergedSectionEdges(operation,prior);
    result.maximumSeamAngle=std::max(left.maximumSeamAngle,right.maximumSeamAngle);
    result.guide=left.guide;result.guide.insert(result.guide.end(),right.guide.begin(),right.guide.end());
    return result;
}

TopoDS_Wire circleWire(gp_Pnt center,gp_Dir normal,double radius) {
    BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(center,normal),radius));
    if(!edge.IsDone()) fail("Could not construct a vessel section circle.");
    BRepBuilderAPI_MakeWire wire(edge.Edge());
    if(!wire.IsDone()) fail("Could not construct a vessel section wire.");
    return wire.Wire();
}

TopoDS_Face circleFace(gp_Pnt center,gp_Dir normal,double radius) {
    BRepBuilderAPI_MakeFace face(circleWire(center,normal,radius),true);
    if(!face.IsDone()) fail("Could not construct a vessel section face.");
    return face.Face();
}

struct CurveRange { Handle(Geom_Curve) curve; double first=0,last=0; };

std::vector<double> interpolationParameters(const std::vector<Vec3>& points) {
    if(points.size()<2) fail("A centerline requires at least two points.");
    std::vector<double> parameters(points.size());
    for(size_t i=1;i<points.size();++i) {
        const auto distance=(points[i]-points[i-1]).length();
        if(!std::isfinite(distance)||distance<=Precision::Confusion())
            fail("Centerline samples are too close for exact interpolation.");
        parameters[i]=parameters[i-1]+std::sqrt(distance);
    }
    return parameters;
}

CurveRange interpolatePoints(const std::vector<Vec3>& input,bool periodic=false) {
    auto points=input;
    if(periodic&&points.size()>2&&(points.front()-points.back()).length()<=Precision::Confusion()) points.pop_back();
    if(points.size()<2) fail("A vessel centerline requires at least two points.");
    Handle(TColgp_HArray1OfPnt) values=new TColgp_HArray1OfPnt(1,static_cast<Standard_Integer>(points.size()));
    const auto parameterCount=static_cast<Standard_Integer>(points.size()+(periodic?1:0));
    Handle(TColStd_HArray1OfReal) parameters=new TColStd_HArray1OfReal(1,parameterCount);
    double parameter=0;parameters->SetValue(1,parameter);values->SetValue(1,point(points.front()));
    for(size_t i=1;i<points.size();++i) {
        const auto distance=(points[i]-points[i-1]).length();
        if(!std::isfinite(distance)||distance<=Precision::Confusion()) fail("Vessel centerline samples are too close for exact interpolation.");
        parameter+=std::sqrt(distance);parameters->SetValue(static_cast<Standard_Integer>(i+1),parameter);
        values->SetValue(static_cast<Standard_Integer>(i+1),point(points[i]));
    }
    if(periodic) {
        const auto distance=(points.front()-points.back()).length();
        if(!std::isfinite(distance)||distance<=Precision::Confusion()) fail("Closed vessel centerline samples are too close.");
        parameter+=std::sqrt(distance);parameters->SetValue(parameterCount,parameter);
    }
    GeomAPI_Interpolate interpolation(values,parameters,periodic,Precision::Confusion());
    interpolation.Perform();if(!interpolation.IsDone()) fail("Could not interpolate the vessel centerline.");
    return {interpolation.Curve(),parameters->Value(1),parameters->Value(parameterCount)};
}

bool closeTo(Vec3 a,Vec3 b,double tolerance) {
    const auto difference=a-b;return difference.finite()&&difference.length()<=tolerance;
}

struct SplineConnection {
    size_t curve=0;
    double parameter=0;
    Vec3 point;
    double distance=std::numeric_limits<double>::infinity();
    bool sampled=false;
};

std::optional<SplineConnection> splineConnection(const Curve& source,size_t curveIndex,
                                                 Vec3 endpoint,double tolerance) {
    const auto parameters=interpolationParameters(source.points);
    std::optional<SplineConnection> best;
    for(size_t i=0;i<source.points.size();++i) {
        const auto distance=(source.points[i]-endpoint).length();
        if(std::isfinite(distance)&&distance<=tolerance
           &&(!best||distance<best->distance))
            best=SplineConnection{curveIndex,parameters[i],source.points[i],distance,true};
    }
    const auto range=interpolatePoints(source.points);
    GeomAPI_ProjectPointOnCurve projection(point(endpoint),range.curve,range.first,range.last);
    if(projection.NbPoints()>0) {
        const auto distance=projection.LowerDistance();
        if(std::isfinite(distance)&&distance<=tolerance
           &&(!best||distance<best->distance))
            best=SplineConnection{curveIndex,projection.LowerDistanceParameter(),
                                  point(projection.NearestPoint()),distance,false};
    }
    return best;
}

std::optional<SplineConnection> nearestSplineConnection(const std::vector<Curve>& curves,Vec3 endpoint,double tolerance) {
    if(!endpoint.finite()) fail("Centerline coordinates must be finite.");
    std::optional<SplineConnection> best;
    for(size_t curveIndex=0;curveIndex<curves.size();++curveIndex) {
        const auto candidate=splineConnection(curves[curveIndex],curveIndex,endpoint,tolerance);
        if(candidate&&(!best||candidate->distance<best->distance)) best=candidate;
    }
    return best;
}

CurveRange branchCurve(const Network& network,const Branch& branch) {
    // Preserve the full imported curve when this branch is a contiguous range
    // of its samples. Interpolating first and extracting the range avoids a
    // tangent/shape change merely because graph construction split a branch.
    if(branch.start!=branch.end) for(const auto& source:network.curves) {
        if(source.points.size()<branch.points.size()) continue;
        const auto tolerance=std::max(network.tolerance*1.01,Precision::Confusion());
        for(size_t start=0;start<source.points.size();++start) for(int directionSign:{1,-1}) {
            const auto finish=static_cast<long long>(start)+static_cast<long long>(directionSign)*(static_cast<long long>(branch.points.size())-1);
            if(finish<0||finish>=static_cast<long long>(source.points.size())) continue;
            bool matches=true;
            for(size_t i=0;i<branch.points.size();++i) {
                const auto sourceIndex=static_cast<size_t>(static_cast<long long>(start)+static_cast<long long>(directionSign)*static_cast<long long>(i));
                if(!closeTo(source.points[sourceIndex],branch.points[i],tolerance)) {matches=false;break;}
            }
            if(!matches) continue;
            auto full=interpolatePoints(source.points);
            // Recreate the explicit centripetal parameters used by interpolatePoints.
            std::vector<double> parameters(source.points.size());
            for(size_t i=1;i<source.points.size();++i) parameters[i]=parameters[i-1]+std::sqrt((source.points[i]-source.points[i-1]).length());
            if(directionSign>0) return {full.curve,parameters[start],parameters[static_cast<size_t>(finish)]};
            auto reversed=Handle(Geom_Curve)::DownCast(full.curve->Reversed());
            return {reversed,full.curve->ReversedParameter(parameters[start]),full.curve->ReversedParameter(parameters[static_cast<size_t>(finish)])};
        }
    }
    return interpolatePoints(branch.points,branch.start==branch.end);
}

std::vector<Vec3> sampleCurve(const CurveRange& range,double deflection) {
    GeomAdaptor_Curve adaptor(range.curve,range.first,range.last);
    GCPnts_QuasiUniformDeflection sampler(adaptor,deflection,range.first,range.last);
    if(!sampler.IsDone()||sampler.NbPoints()<2) fail("Could not sample the exact vessel centerline.");
    std::vector<Vec3> points;points.reserve(static_cast<size_t>(sampler.NbPoints()));
    for(Standard_Integer i=1;i<=sampler.NbPoints();++i) points.push_back(point(sampler.Value(i)));
    return points;
}

double parameterAtLength(const GeomAdaptor_Curve& adaptor,double first,double length) {
    if(length<=0) return first;
    GCPnts_AbscissaPoint finder(Precision::Confusion(),adaptor,length,first);
    if(!finder.IsDone()) fail("Could not locate an arc-length vessel setback.");
    return finder.Parameter();
}

struct RingData {
    gp_Pnt center;
    gp_Dir towardNode;
    double radius=0;
    int branch=-1;
    Handle(Geom_Curve) guide;
    double ringParameter=0,nodeParameter=0;
    TopoDS_Shape branchShape;
};
struct BranchGeometry { OwnedShape solid; RingData startRing; RingData endRing; };

BranchGeometry buildBranchGeometry(const Network& network,const Branch& branch,int index) {
    if(!std::isfinite(branch.diameter)||branch.diameter<=2*Precision::Confusion())
        fail("Assigned vessel diameter is below modeling precision or nonfinite.");
    auto range=branchCurve(network,branch);GeomAdaptor_Curve adaptor(range.curve,range.first,range.last);
    const auto total=GCPnts_AbscissaPoint::Length(adaptor,range.first,range.last,Precision::Confusion());
    if(!std::isfinite(total)||total<=Precision::Confusion()) fail("Vessel centerline has no usable arc length.");
    const auto startFraction=network.nodes[branch.start].degree>2?branch.startSetback:0;
    const auto endFraction=network.nodes[branch.end].degree>2?branch.endSetback:0;
    if(!std::isfinite(startFraction)||!std::isfinite(endFraction)||startFraction<0||endFraction<0||startFraction+endFraction>=1)
        fail("Vessel setbacks are invalid.");
    const auto first=parameterAtLength(adaptor,range.first,total*startFraction);
    const auto last=parameterAtLength(adaptor,range.first,total*(1-endFraction));
    if(!(first<last)) fail("Vessel setbacks leave no sweepable centerline.");
    gp_Pnt startPoint,endPoint;gp_Vec startTangent,endTangent;
    range.curve->D1(first,startPoint,startTangent);range.curve->D1(last,endPoint,endTangent);
    if(startTangent.SquareMagnitude()<=Precision::SquareConfusion()||endTangent.SquareMagnitude()<=Precision::SquareConfusion())
        fail("Vessel centerline has an undefined endpoint tangent.");
    BRepBuilderAPI_MakeEdge edge(range.curve,first,last);if(!edge.IsDone()) fail("Could not trim the vessel centerline.");
    BRepBuilderAPI_MakeWire spine(edge.Edge());if(!spine.IsDone()) fail("Could not construct the vessel sweep path.");
    const auto radius=branch.diameter/2;
    const gp_Dir sweepDirection(startTangent);
    BRepOffsetAPI_MakePipe pipe(spine.Wire(),circleFace(startPoint,sweepDirection,radius),GeomFill_IsCorrectedFrenet,true);
    if(!pipe.IsDone()) fail("Could not sweep the vessel branch.");
    auto shape=pipe.Shape();
    if(shape.IsNull()||solidCount(shape)!=1||!BRepCheck_Analyzer(shape).IsValid()) fail("Vessel sweep is not one valid solid.");
    BranchGeometry result;result.solid=ownedShape(shape,index);
    result.startRing={startPoint,gp_Dir(startTangent.Reversed()),radius,index,
                      range.curve,first,range.first,result.solid.shape};
    result.endRing={endPoint,gp_Dir(endTangent),radius,index,
                    range.curve,last,range.last,result.solid.shape};
    return result;
}

TopoDS_Edge directedGuideEdge(const RingData& ring,bool ringToNode) {
    if(ring.guide.IsNull()||ring.ringParameter==ring.nodeParameter)
        fail("Vessel transition has no usable centerline guide.");
    const auto low=std::min(ring.ringParameter,ring.nodeParameter);
    const auto high=std::max(ring.ringParameter,ring.nodeParameter);
    BRepBuilderAPI_MakeEdge builder(ring.guide,low,high);
    if(!builder.IsDone()) fail("Could not build the vessel transition guide edge.");
    auto edge=builder.Edge();
    const auto from=ringToNode?ring.ringParameter:ring.nodeParameter;
    const auto to=ringToNode?ring.nodeParameter:ring.ringParameter;
    if(to<from) edge.Reverse();
    return edge;
}

gp_Vec directedTangent(const RingData& ring,bool ringToNode,bool atEnd) {
    const auto from=ringToNode?ring.ringParameter:ring.nodeParameter;
    const auto to=ringToNode?ring.nodeParameter:ring.ringParameter;
    gp_Pnt location;gp_Vec tangent;
    ring.guide->D1(atEnd?to:from,location,tangent);
    if(to<from) tangent.Reverse();
    if(tangent.SquareMagnitude()<=Precision::SquareConfusion())
        fail("Vessel transition guide has an undefined tangent.");
    return tangent;
}

double edgeLength(const TopoDS_Edge& edge) {
    BRepAdaptor_Curve adaptor(edge);
    const auto length=GCPnts_AbscissaPoint::Length(adaptor,adaptor.FirstParameter(),adaptor.LastParameter(),Precision::Confusion());
    if(!std::isfinite(length)||length<=Precision::Confusion()) fail("Vessel transition guide has no usable length.");
    return length;
}

std::vector<Vec3> guideSamples(const RingData& ring,bool ringToNode) {
    const auto from=ringToNode?ring.ringParameter:ring.nodeParameter;
    const auto to=ringToNode?ring.nodeParameter:ring.ringParameter;
    std::vector<Vec3> samples;samples.reserve(9);
    for(int i=0;i<=8;++i) samples.push_back(point(ring.guide->Value(from+(to-from)*i/8.0)));
    return samples;
}

gp_Dir lateralNormalAt(const TopoDS_Shape& shape,gp_Pnt sample,gp_Dir radial,double radius) {
    double best=-1;std::optional<gp_Dir> normal;
    for(TopExp_Explorer explorer(shape,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=TopoDS::Face(explorer.Current());const auto surface=BRep_Tool::Surface(face);
        if(surface.IsNull()) continue;
        GeomAPI_ProjectPointOnSurf projection(sample,surface);
        for(Standard_Integer i=1;i<=projection.NbPoints();++i) {
            if(projection.Distance(i)>std::max(1e-5,radius*1e-5)) continue;
            Standard_Real u=0,v=0;projection.Parameters(i,u,v);
            BRepClass_FaceClassifier classifier(face,gp_Pnt2d(u,v),Precision::Confusion()*10);
            if(classifier.State()!=TopAbs_IN&&classifier.State()!=TopAbs_ON) continue;
            GeomLProp_SLProps properties(surface,u,v,1,Precision::Confusion());
            if(!properties.IsNormalDefined()) continue;
            const auto candidate=properties.Normal();const auto score=std::abs(candidate.Dot(radial));
            if(score>best) {best=score;normal=candidate;}
        }
    }
    if(!normal||best<.5) fail("Could not evaluate a lateral vessel surface normal at the transition seam.");
    return *normal;
}

double seamAngle(const TopoDS_Shape& branch,const TopoDS_Shape& transition,
                 gp_Pnt center,gp_Dir tangent,double radius) {
    gp_Vec reference=std::abs(tangent.Z())<.9?gp_Vec(0,0,1):gp_Vec(1,0,0);
    gp_Vec x=gp_Vec(tangent).Crossed(reference);x.Normalize();
    const gp_Vec y=gp_Vec(tangent).Crossed(x);
    double maximum=0;
    for(int i=0;i<8;++i) {
        const auto angle=2*std::numbers::pi*i/8;
        const gp_Dir radial(x*std::cos(angle)+y*std::sin(angle));
        const auto sample=center.Translated(gp_Vec(radial)*radius);
        const auto a=lateralNormalAt(branch,sample,radial,radius);
        const auto b=lateralNormalAt(transition,sample,radial,radius);
        maximum=std::max(maximum,std::acos(std::clamp(std::abs(a.Dot(b)),0.0,1.0)));
    }
    return maximum;
}

OwnedShape guidedSweep(const TopoDS_Wire& spine,gp_Pnt start,gp_Dir tangent,
                       double startRadius,double endRadius,double length,int owner) {
    if(!std::isfinite(startRadius)||!std::isfinite(endRadius)||startRadius<=Precision::Confusion()
       ||endRadius<=Precision::Confusion()||!std::isfinite(length)||length<=Precision::Confusion())
        fail("Vessel transition radii or guide length are invalid.");
    TColgp_Array1OfPnt2d values(1,2);
    values.SetValue(1,gp_Pnt2d(0,1));values.SetValue(2,gp_Pnt2d(length,endRadius/startRadius));
    Handle(Law_Interpol) law=new Law_Interpol();
    law->Set(values,0,0,false);
    const auto profile=circleWire(start,tangent,startRadius);
    BRepOffsetAPI_MakePipeShell sweep(spine);
    sweep.SetForceApproxC1(true);
    sweep.SetLaw(profile,law,false,false);
    sweep.Build();
    if(!sweep.IsDone()||!sweep.MakeSolid()) fail("Could not build the centerline-guided vessel transition.");
    auto shape=sweep.Shape();
    if(shape.IsNull()||solidCount(shape)!=1||!BRepCheck_Analyzer(shape).IsValid())
        fail("Centerline-guided vessel transition is not one valid solid.");
    return ownedShape(shape,owner);
}

OwnedShape partialTransition(Vec3 node,int nodeIndex,const RingData& first,const RingData& second) {
    if(first.guide.IsNull()||second.guide.IsNull()) fail("Vessel transition is missing an exact centerline guide.");
    if(first.guide->Value(first.nodeParameter).Distance(point(node))>Precision::Confusion()*10
       ||second.guide->Value(second.nodeParameter).Distance(point(node))>Precision::Confusion()*10)
        fail("Vessel transition guides do not meet at the junction node.");
    const auto firstEdge=directedGuideEdge(first,true);
    const auto secondEdge=directedGuideEdge(second,false);
    const gp_Dir incoming(directedTangent(first,true,true));
    const gp_Dir outgoing(directedTangent(second,false,false));
    if(incoming.Dot(outgoing)<std::cos(1e-3))
        fail("Assigned vessel centerlines do not form a tangent-continuous provisional guide at the junction.");
    BRepBuilderAPI_MakeWire wire;wire.Add(firstEdge);wire.Add(secondEdge);
    if(!wire.IsDone()) fail("Could not join the exact vessel centerline tails into a transition guide.");
    const auto length=edgeLength(firstEdge)+edgeLength(secondEdge);
    auto result=guidedSweep(wire.Wire(),first.center,gp_Dir(directedTangent(first,true,false)),
                            first.radius,second.radius,length,-(nodeIndex+1));
    result.maximumSeamAngle=std::max(seamAngle(first.branchShape,result.shape,first.center,first.towardNode,first.radius),
                                     seamAngle(second.branchShape,result.shape,second.center,second.towardNode,second.radius));
    if(!std::isfinite(result.maximumSeamAngle)||result.maximumSeamAngle>1e-4)
        fail("Centerline-guided provisional transition is not tangent-continuous at a branch seam.");
    result.guide=guideSamples(first,true);
    auto secondSamples=guideSamples(second,false);
    result.guide.insert(result.guide.end(),secondSamples.begin()+1,secondSamples.end());
    return result;
}

OwnedShape fullJunction(Vec3 node,int nodeIndex,const std::vector<RingData>& rings,double requestedRadius) {
    double coreRadius=0,minRadius=std::numeric_limits<double>::infinity();
    for(const auto& ring:rings) {coreRadius=std::max(coreRadius,ring.radius);minRadius=std::min(minRadius,ring.radius);}
    if(requestedRadius>0&&requestedRadius>=minRadius)
        fail("Requested junction radius must be smaller than every incident vessel radius.");
    for(const auto& ring:rings) {
        const auto distance=(point(ring.center)-node).length();
        if(coreRadius*coreRadius>distance*distance+ring.radius*ring.radius)
            fail("Junction setback is too short to contain the unequal-diameter central blend.");
    }
    BRepPrimAPI_MakeSphere sphere(point(node),coreRadius);
    auto sphereShape=sphere.Shape();
    if(!sphere.IsDone()||sphereShape.IsNull()) fail("Could not construct the junction core.");
    const auto owner=-(nodeIndex+1);auto core=ownedShape(sphereShape,owner);
    for(const auto& ring:rings) {
        const auto edge=directedGuideEdge(ring,true);
        BRepBuilderAPI_MakeWire wire(edge);
        if(!wire.IsDone()) fail("Could not construct the exact vessel junction arm guide.");
        auto arm=guidedSweep(wire.Wire(),ring.center,gp_Dir(directedTangent(ring,true,false)),
                             ring.radius,coreRadius*.8,edgeLength(edge),owner);
        arm.maximumSeamAngle=seamAngle(ring.branchShape,arm.shape,ring.center,ring.towardNode,ring.radius);
        if(!std::isfinite(arm.maximumSeamAngle)||arm.maximumSeamAngle>1e-4)
            fail("Centerline-guided junction arm is not tangent-continuous at its branch seam.");
        arm.guide=guideSamples(ring,true);
        core=fuseOwned(core,arm);
    }
    if(solidCount(core.shape)!=1) fail("Junction core did not form one joined solid.");
    if(requestedRadius>0) {
        BRepFilletAPI_MakeFillet fillet(core.shape);int count=0;
        for(const auto& edge:core.sectionEdges) if(edge.ShapeType()==TopAbs_EDGE) {
            fillet.Add(requestedRadius,TopoDS::Edge(edge));++count;
        }
        if(count==0) fail("Junction construction produced no internal intersection edges to round.");
        fillet.Build();
        if(!fillet.IsDone()) fail("Requested junction round could not be built.");
        auto rounded=fillet.Shape();
        if(rounded.IsNull()||solidCount(rounded)!=1||!BRepCheck_Analyzer(rounded).IsValid())
            fail("Requested junction round produced an invalid solid.");
        const auto maximumSeamAngle=core.maximumSeamAngle;auto guide=std::move(core.guide);
        core=ownedShape(rounded,owner);core.maximumSeamAngle=maximumSeamAngle;core.guide=std::move(guide);
    }
    return core;
}

QString failureText(const std::exception& error) { return QString::fromUtf8(error.what()); }
QString failureText(const Standard_Failure& error) {
    const auto detail=error.GetMessageString();return detail&&*detail?QString::fromUtf8(detail):QString("Open CASCADE operation failed.");
}

} // namespace

Vec3 planePoint(Plane plane,QPointF value,double offset) {
    if(!finite(value)||!std::isfinite(offset)) fail("Plane coordinates and offset must be finite.");
    switch(plane) {
    case Plane::Front: return {value.x(),value.y(),offset};
    case Plane::Top: return {value.x(),offset,-value.y()};
    case Plane::Right: return {offset,value.x(),value.y()};
    }
    fail("Unknown sketch plane.");
}

Vec3 planeNormal(Plane plane) {
    switch(plane) {
    case Plane::Front: return {0,0,1};
    case Plane::Top: return {0,1,0};
    case Plane::Right: return {1,0,0};
    }
    fail("Unknown sketch plane.");
}

Network addCenterlineWithSplineConnections(const Network& previous,const Curve& curve) {
    try {
        if(!std::isfinite(previous.tolerance)||previous.tolerance<=0)
            fail("Connection tolerance must be positive and finite.");
        if(curve.points.size()<2) fail("A centerline requires at least two points.");
        for(const auto& value:curve.points) if(!value.finite()) fail("Centerline coordinates must be finite.");

        struct Insertion { size_t curve=0,index=0; double parameter=0; Vec3 point; };
        std::vector<Insertion> existingInsertions,newInsertions;
        auto adjusted=curve;

        // First connect each new endpoint to the nearest existing full
        // interpolant. The endpoint is snapped by at most the model tolerance,
        // and the identical point is inserted into that existing source curve.
        for(const auto endpointIndex:{size_t(0),curve.points.size()-1}) {
            const auto hit=nearestSplineConnection(previous.curves,curve.points[endpointIndex],previous.tolerance);
            if(!hit) continue;
            adjusted.points[endpointIndex]=hit->point;
            if(!hit->sampled) {
                const auto parameters=interpolationParameters(previous.curves[hit->curve].points);
                const auto at=static_cast<size_t>(std::upper_bound(parameters.begin(),parameters.end(),hit->parameter)-parameters.begin());
                if(at>0&&at<parameters.size()) existingInsertions.push_back({hit->curve,at,hit->parameter,hit->point});
            }
        }

        // Apply the same rule in reverse: an endpoint of an existing curve can
        // land on the interior of the new full interpolant. Keep the established
        // endpoint fixed and insert it into the new source curve.
        for(const auto& source:previous.curves) {
            if(source.points.size()<2) fail("A centerline requires at least two points.");
            for(const auto endpointIndex:{size_t(0),source.points.size()-1}) {
                const auto hit=splineConnection(curve,0,source.points[endpointIndex],previous.tolerance);
                if(!hit||hit->sampled) continue;
                const auto parameters=interpolationParameters(curve.points);
                const auto at=static_cast<size_t>(std::upper_bound(parameters.begin(),parameters.end(),hit->parameter)-parameters.begin());
                if(at>0&&at<parameters.size()) newInsertions.push_back({0,at,hit->parameter,source.points[endpointIndex]});
            }
        }

        auto insert=[](std::vector<Curve>& curves,std::vector<Insertion>& additions,double tolerance) {
            std::sort(additions.begin(),additions.end(),[](const auto& a,const auto& b) {
                if(a.curve!=b.curve) return a.curve<b.curve;
                if(a.index!=b.index) return a.index>b.index;
                return a.parameter>b.parameter;
            });
            std::vector<Insertion> applied;
            for(const auto& addition:additions) {
                if(std::any_of(applied.begin(),applied.end(),[&](const auto& prior) {
                    return prior.curve==addition.curve&&closeTo(prior.point,addition.point,tolerance);
                })) continue;
                auto& points=curves.at(addition.curve).points;
                points.insert(points.begin()+static_cast<ptrdiff_t>(addition.index),addition.point);
                applied.push_back(addition);
            }
        };

        auto enriched=previous;
        insert(enriched.curves,existingInsertions,previous.tolerance);
        std::vector<Curve> adjustedHolder{adjusted};
        insert(adjustedHolder,newInsertions,previous.tolerance);
        // addCenterline compares the rebuilt branches with previous.branches,
        // so diameter and setback values on unaffected branches are retained.
        auto connected=addCenterline(enriched,adjustedHolder.front());
        auto exactCurves=enriched.curves;exactCurves.push_back(adjustedHolder.front());
        auto sameInputs=[](const std::vector<Curve>& a,const std::vector<Curve>& b) {
            if(a.size()!=b.size()) return false;
            for(size_t i=0;i<a.size();++i) {
                if(a[i].id!=b[i].id||a[i].points.size()!=b[i].points.size()) return false;
                for(size_t j=0;j<a[i].points.size();++j)
                    if(a[i].points[j].x!=b[i].points[j].x||a[i].points[j].y!=b[i].points[j].y
                       ||a[i].points[j].z!=b[i].points[j].z) return false;
            }
            return true;
        };
        if(sameInputs(connected.curves,exactCurves)) return connected;

        // Core point workflow also considers straight sampled chords. Rebuild
        // from the explicitly authorized spline insertions when that fallback
        // added another point, so a point far from the actual spline cannot
        // create a false connection.
        auto exact=buildNetwork(exactCurves,previous.tolerance);
        auto carry=[&](const std::vector<Branch>& donors) {
            for(auto& branch:exact.branches) if(branch.diameter==0) for(const auto& old:donors) {
                if(branch.points.size()!=old.points.size()) continue;
                bool same=true,reverse=true;
                for(size_t i=0;i<branch.points.size();++i) {
                    same&=closeTo(branch.points[i],old.points[i],previous.tolerance);
                    reverse&=closeTo(branch.points[i],old.points[old.points.size()-1-i],previous.tolerance);
                }
                if(same||reverse) {
                    branch.diameter=old.diameter;
                    branch.startSetback=reverse&&!same?old.endSetback:old.startSetback;
                    branch.endSetback=reverse&&!same?old.startSetback:old.endSetback;
                    break;
                }
            }
        };
        carry(previous.branches);carry(connected.branches);
        return exact;
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE operation failed.");
    }
}

static CadResult buildCadImpl(const CadModel& model,double deflection) {
    if(!std::isfinite(deflection)||deflection<1e-4||deflection>1.0)
        fail("CAD deflection must be between 0.0001 and 1.");
    std::set<QString> sketchIds,featureIds;
    for(const auto& sketch:model.sketches) {
        if(sketch.id.isEmpty()||!sketchIds.insert(sketch.id).second) fail("Sketch identifiers must be nonempty and unique.");
    }
    if(model.features.empty()) return {};
    TopoDS_Shape shape;
    std::vector<OwnedFace> owners;
    for(size_t i=0;i<model.features.size();++i) {
        const auto& feature=model.features[i];
        if(feature.id.isEmpty()||!featureIds.insert(feature.id).second) fail("CAD feature identifiers must be nonempty and unique.");
        if(feature.sketch<0||feature.sketch>=static_cast<int>(model.sketches.size())) fail("CAD feature refers to an invalid sketch.");
        if(feature.operation!=CadOperation::Boss&&feature.operation!=CadOperation::Cut) fail("Unknown CAD feature operation.");
        const auto tool=prismFor(model.sketches[feature.sketch],feature,shape);
        shape=applyFeature(shape,tool,feature,static_cast<int>(i),owners);
    }
    const auto volume=volumeOf(shape);
    if(!std::isfinite(volume)||volume<=changeTolerance(volume)) fail("CAD model has no usable solid volume.");
    CadResult result;
    result.triangles=meshShape(shape,deflection,owners);
    result.volume=volume;
    result.nativeShape=std::static_pointer_cast<const void>(std::make_shared<TopoDS_Shape>(shape));
    return result;
}

CadResult buildCad(const CadModel& model,double deflection) {
    try {
        return buildCadImpl(model,deflection);
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE operation failed.");
    }
}

static VesselResult buildVesselsImpl(const Network& network,double deflection,double junctionRadius) {
    if(!std::isfinite(deflection)||deflection<1e-4||deflection>1.0)
        fail("Vessel deflection must be between 0.0001 and 1.");
    if(!std::isfinite(junctionRadius)||junctionRadius<0) fail("Junction radius must be nonnegative and finite.");
    if(!std::isfinite(network.tolerance)||network.tolerance<=0) fail("Network tolerance must be positive and finite.");
    VesselResult result;
    std::vector<std::optional<OwnedShape>> groups(network.branches.size());
    std::vector<int> branchGroup(network.branches.size(),-1);
    std::vector<std::optional<RingData>> startRings(network.branches.size()),endRings(network.branches.size());
    result.branches.reserve(network.branches.size());
    result.centerlines.reserve(network.branches.size());
    for(size_t i=0;i<network.branches.size();++i) {
        const auto& branch=network.branches[i];
        if(branch.start<0||branch.end<0||branch.start>=static_cast<int>(network.nodes.size())||branch.end>=static_cast<int>(network.nodes.size()))
            fail("Vessel branch endpoint index is invalid.");
        try { result.centerlines.push_back(sampleCurve(branchCurve(network,branch),deflection)); }
        catch(const Standard_Failure&) { result.centerlines.push_back(branch.points); }
        catch(const std::exception&) { result.centerlines.push_back(branch.points); }
        VesselItemResult status{static_cast<int>(i),VesselBuildState::Provisional,"Diameter is unassigned."};
        if(branch.diameter!=0) try {
            auto geometry=buildBranchGeometry(network,branch,static_cast<int>(i));
            groups[i]=geometry.solid;branchGroup[i]=static_cast<int>(i);
            startRings[i]=geometry.startRing;endRings[i]=geometry.endRing;
            status={static_cast<int>(i),VesselBuildState::Built,"Exact circular sweep built."};
        } catch(const Standard_Failure& error) {
            status={static_cast<int>(i),VesselBuildState::Failed,failureText(error)};
        } catch(const std::exception& error) {
            status={static_cast<int>(i),VesselBuildState::Failed,failureText(error)};
        }
        result.branches.push_back(std::move(status));
    }

    auto mergeConnector=[&](const std::vector<RingData>& rings,OwnedShape connector) {
        std::vector<int> indices;
        for(const auto& ring:rings) {
            const auto group=branchGroup[static_cast<size_t>(ring.branch)];
            if(group<0||!groups[static_cast<size_t>(group)]) fail("Junction refers to an unavailable vessel branch solid.");
            if(std::find(indices.begin(),indices.end(),group)==indices.end()) indices.push_back(group);
        }
        if(indices.empty()) fail("Junction has no branch solids to join.");
        auto combined=std::move(connector);
        for(auto index:indices) combined=fuseOwned(*groups[static_cast<size_t>(index)],combined);
        if(solidCount(combined.shape)!=1) fail("Junction did not join its incident branches into one solid.");
        const auto destination=indices.front();groups[static_cast<size_t>(destination)]=std::move(combined);
        for(size_t k=1;k<indices.size();++k) groups[static_cast<size_t>(indices[k])].reset();
        for(auto& group:branchGroup) if(std::find(indices.begin(),indices.end(),group)!=indices.end()) group=destination;
    };

    for(int node=0;node<static_cast<int>(network.nodes.size());++node) {
        if(network.nodes[static_cast<size_t>(node)].degree<=2) continue;
        int incident=0,assigned=0;bool branchFailure=false;
        std::vector<RingData> rings;
        for(size_t i=0;i<network.branches.size();++i) {
            const auto& branch=network.branches[i];
            auto add=[&](const std::optional<RingData>& ring) {
                ++incident;
                if(branch.diameter>0) {
                    ++assigned;
                    if(ring) rings.push_back(*ring); else branchFailure=true;
                }
            };
            if(branch.start==node) add(startRings[i]);
            if(branch.end==node) add(endRings[i]);
        }
        VesselItemResult status{node,VesselBuildState::Provisional,
                                QString("%1 of %2 incident diameters assigned.").arg(assigned).arg(incident)};
        if(branchFailure) status={node,VesselBuildState::Failed,"An assigned incident branch could not be swept."};
        else if(assigned<incident) {
            if(incident==3&&rings.size()==2) try {
                auto transition=partialTransition(network.nodes[static_cast<size_t>(node)].point,node,rings[0],rings[1]);
                const auto maximumSeamAngle=transition.maximumSeamAngle;auto guide=transition.guide;
                mergeConnector(rings,std::move(transition));
                status={node,VesselBuildState::Provisional,
                        "Two assigned arms have an exact centerline-guided varying-radius transition; one arm remains unassigned.",
                        maximumSeamAngle,std::move(guide)};
            } catch(const Standard_Failure& error) {
                status={node,VesselBuildState::Failed,failureText(error)};
            } catch(const std::exception& error) {
                status={node,VesselBuildState::Failed,failureText(error)};
            }
        } else if(incident>=3&&static_cast<int>(rings.size())==incident) try {
            auto junction=fullJunction(network.nodes[static_cast<size_t>(node)].point,node,rings,junctionRadius);
            const auto maximumSeamAngle=junction.maximumSeamAngle;auto guide=junction.guide;
            mergeConnector(rings,std::move(junction));
            status={node,VesselBuildState::Built,
                    junctionRadius>0?"Joined and rounded centerline-guided junction solid built.":"Joined centerline-guided junction solid built.",
                    maximumSeamAngle,std::move(guide)};
        } catch(const Standard_Failure& error) {
            status={node,VesselBuildState::Failed,failureText(error)};
        } catch(const std::exception& error) {
            status={node,VesselBuildState::Failed,failureText(error)};
        }
        result.junctions.push_back(std::move(status));
    }

    std::vector<TopoDS_Shape> shapes;
    for(auto& group:groups) if(group) {
        const auto volume=volumeOf(group->shape);
        if(!std::isfinite(volume)||volume<=0) fail("Vessel result contains an invalid solid volume.");
        result.volume+=volume;
        auto triangles=meshShape(group->shape,deflection,group->owners);
        result.triangles.insert(result.triangles.end(),triangles.begin(),triangles.end());
        shapes.push_back(group->shape);
    }
    if(shapes.empty()) return result;
    TopoDS_Shape native;
    if(shapes.size()==1) native=shapes.front();
    else {
        TopoDS_Compound compound;BRep_Builder builder;builder.MakeCompound(compound);
        for(const auto& shape:shapes) builder.Add(compound,shape);
        native=compound;
    }
    if(!BRepCheck_Analyzer(native).IsValid()) fail("Combined vessel result is invalid.");
    result.nativeShape=std::static_pointer_cast<const void>(std::make_shared<TopoDS_Shape>(native));
    return result;
}

bool samePoint(Vec3 a,Vec3 b) { return a.x==b.x&&a.y==b.y&&a.z==b.z; }

bool sameNetwork(const Network& a,const Network& b) {
    if(a.tolerance!=b.tolerance||a.curves.size()!=b.curves.size()||a.nodes.size()!=b.nodes.size()
       ||a.branches.size()!=b.branches.size()) return false;
    for(size_t i=0;i<a.curves.size();++i) {
        if(a.curves[i].id!=b.curves[i].id||a.curves[i].points.size()!=b.curves[i].points.size()) return false;
        for(size_t j=0;j<a.curves[i].points.size();++j) if(!samePoint(a.curves[i].points[j],b.curves[i].points[j])) return false;
    }
    for(size_t i=0;i<a.nodes.size();++i)
        if(a.nodes[i].degree!=b.nodes[i].degree||!samePoint(a.nodes[i].point,b.nodes[i].point)) return false;
    for(size_t i=0;i<a.branches.size();++i) {
        const auto& x=a.branches[i];const auto& y=b.branches[i];
        if(x.id!=y.id||x.start!=y.start||x.end!=y.end||x.diameter!=y.diameter
           ||x.startSetback!=y.startSetback||x.endSetback!=y.endSetback||x.points.size()!=y.points.size()) return false;
        for(size_t j=0;j<x.points.size();++j) if(!samePoint(x.points[j],y.points[j])) return false;
    }
    return true;
}

VesselResult buildVessels(const Network& network,double deflection,double junctionRadius) {
    try {
        struct CacheEntry { Network network; double deflection=0,junctionRadius=0; VesselResult result; };
        static thread_local std::vector<CacheEntry> cache;
        for(size_t i=0;i<cache.size();++i) if(cache[i].deflection==deflection&&cache[i].junctionRadius==junctionRadius
                                               &&sameNetwork(cache[i].network,network)) {
            auto hit=std::move(cache[i]);cache.erase(cache.begin()+static_cast<std::ptrdiff_t>(i));
            cache.insert(cache.begin(),std::move(hit));return cache.front().result;
        }
        auto built=buildVesselsImpl(network,deflection,junctionRadius);
        size_t sourcePoints=0;for(const auto& curve:network.curves) sourcePoints+=curve.points.size();
        if(sourcePoints<=10000&&built.triangles.size()<=600000) {
            cache.insert(cache.begin(),{network,deflection,junctionRadius,built});
            if(cache.size()>2) cache.pop_back();
        }
        return built;
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE vessel operation failed.");
    }
}

} // namespace mvcad

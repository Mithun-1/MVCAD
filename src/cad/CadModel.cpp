#include "CadModel.h"
#include "core/PointWorkflow.h"

#include <QCryptographicHash>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
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
#include <Geom_BSplineCurve.hxx>
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
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
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
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <list>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <numbers>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>
#include <unordered_map>
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

std::pair<double,double> throughAllRange(const TopoDS_Shape& target,Vec3 origin,Vec3 extrusionDirection) {
    Bnd_Box box;BRepBndLib::Add(target,box);box.SetGap(0);
    if(box.IsVoid()||box.IsOpen()) fail("Cannot determine a finite target extent for Through All.");
    Standard_Real xmin,ymin,zmin,xmax,ymax,zmax;box.Get(xmin,ymin,zmin,xmax,ymax,zmax);
    double minimum=std::numeric_limits<double>::infinity(),maximum=-minimum;
    for(double x:{xmin,xmax}) for(double y:{ymin,ymax}) for(double z:{zmin,zmax})
        {const auto projection=(Vec3{x,y,z}-origin).dot(extrusionDirection);minimum=std::min(minimum,projection);maximum=std::max(maximum,projection);}
    const auto diagonal=(Vec3{xmax,ymax,zmax}-Vec3{xmin,ymin,zmin}).length();
    if(!std::isfinite(minimum)||!std::isfinite(maximum)||!std::isfinite(diagonal)) fail("Target extent exceeds the supported numeric range.");
    const auto pad=std::max(Precision::Confusion()*100,std::max(1.0,diagonal)*1e-6);
    return {minimum-pad,maximum+pad};
}

TopoDS_Shape prismFor(const Sketch& sketch,const CadFeature& feature,const TopoDS_Shape& target) {
    auto face=profileFace(sketch);
    auto extrusionDirection=planeNormal(sketch.plane);
    if(feature.reversed) extrusionDirection=extrusionDirection*-1;
    if(!std::isfinite(feature.depth)||!std::isfinite(feature.secondDepth)||!std::isfinite(feature.startOffset))
        fail("Extrusion depths and start offset must be finite.");
    double start=0,end=0;
    if(feature.extent==CadExtent::ThroughAll) {
        if(feature.operation!=CadOperation::Cut||target.IsNull()) fail("Through All requires an existing body and a cut feature.");
        std::tie(start,end)=throughAllRange(target,planePoint(sketch.plane,{},sketch.offset)+extrusionDirection*feature.startOffset,extrusionDirection);
    } else if(feature.extent==CadExtent::Blind) {
        if(!std::isfinite(feature.depth)||feature.depth<=Precision::Confusion())
            fail("Extrusion depth must be finite and greater than modeling precision.");
        end=feature.depth;
    } else if(feature.extent==CadExtent::MidPlane) {
        if(feature.depth<=Precision::Confusion()) fail("Extrusion depth must be greater than modeling precision.");
        start=-feature.depth/2;end=feature.depth/2;
    } else if(feature.extent==CadExtent::TwoDirections) {
        if(feature.depth<0||feature.secondDepth<0||feature.depth+feature.secondDepth<=Precision::Confusion())
            fail("Two-direction depths must be nonnegative and leave a usable extrusion length.");
        start=-feature.secondDepth;end=feature.depth;
    } else fail("Unknown extrusion extent.");
    start+=feature.startOffset;end+=feature.startOffset;
    if(!(end>start)||!std::isfinite(end-start)) fail("Extrusion range is invalid.");
    face=translated(face,extrusionDirection*start);
    BRepPrimAPI_MakePrism builder(face,vector(extrusionDirection*(end-start)),true,true);
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
    if(result.IsNull()||solidCount(result)!=1||!BRepCheck_Analyzer(result).IsValid())
        fail("CAD feature must leave one valid solid in its target body.");
    return result;
}

std::vector<OwnedFace> filletOwners(BRepFilletAPI_MakeFillet& operation,const TopoDS_Shape& result,
                                    const std::vector<OwnedFace>& previous,int feature) {
    std::vector<OwnedFace> owners;
    for(TopExp_Explorer explorer(result,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=explorer.Current();int owner=feature;
        for(const auto& prior:previous) {
            if(prior.face.IsSame(face)||containsSame(operation.Modified(prior.face),face)
               ||containsSame(operation.Generated(prior.face),face)) {owner=prior.feature;break;}
        }
        owners.push_back({face,owner});
    }
    return owners;
}

struct EdgeRecord { QString id; TopoDS_Edge edge; CadEdgeResult result; };

QString encodedPoint(gp_Pnt value) {
    return QString::number(value.X(),'g',17)+','+QString::number(value.Y(),'g',17)+','+QString::number(value.Z(),'g',17)+';';
}

std::vector<EdgeRecord> edgeRecords(const TopoDS_Shape& shape,const QString& bodyId,
                                    const std::vector<OwnedFace>& owners,const std::vector<CadFeature>& features,
                                    std::optional<double> displayDeflection=std::nullopt) {
    TopTools_IndexedMapOfShape mapped;TopExp::MapShapes(shape,TopAbs_EDGE,mapped);
    std::vector<EdgeRecord> records;records.reserve(static_cast<size_t>(mapped.Extent()));
    for(Standard_Integer edgeIndex=1;edgeIndex<=mapped.Extent();++edgeIndex) {
        const auto edge=TopoDS::Edge(mapped(edgeIndex));BRepAdaptor_Curve curve(edge);
        const auto first=curve.FirstParameter(),last=curve.LastParameter();
        const auto length=GCPnts_AbscissaPoint::Length(curve,first,last,Precision::Confusion());
        if(!std::isfinite(length)||length<=Precision::Confusion()) continue;
        std::vector<Vec3> fingerprintSamples;fingerprintSamples.reserve(17);
        for(int i=0;i<=16;++i) {
            double parameter=first;
            if(i==16) parameter=last;
            else if(i>0) {GCPnts_AbscissaPoint location(Precision::Confusion(),curve,length*i/16.0,first);if(!location.IsDone()) fail("Could not sample a selectable CAD edge.");parameter=location.Parameter();}
            const auto sample=point(curve.Value(parameter));if(!sample.finite()) fail("Selectable CAD edge exceeds the supported numeric range.");
            fingerprintSamples.push_back(sample);
        }
        QString forward,reverse;
        for(const auto& sample:fingerprintSamples) forward+=encodedPoint(point(sample));
        for(auto it=fingerprintSamples.rbegin();it!=fingerprintSamples.rend();++it) reverse+=encodedPoint(point(*it));
        const auto canonical=std::min(forward,reverse);
        std::set<QString> lineage;
        for(TopExp_Explorer faceExplorer(shape,TopAbs_FACE);faceExplorer.More();faceExplorer.Next()) {
            const auto face=faceExplorer.Current();bool adjacent=false;
            for(TopExp_Explorer faceEdge(face,TopAbs_EDGE);faceEdge.More();faceEdge.Next())
                if(faceEdge.Current().IsSame(edge)) {adjacent=true;break;}
            if(!adjacent) continue;
            const auto owner=std::find_if(owners.begin(),owners.end(),[&](const auto& candidate){return candidate.face.IsSame(face);});
            if(owner!=owners.end()&&owner->feature>=0&&owner->feature<static_cast<int>(features.size())) lineage.insert(features[static_cast<size_t>(owner->feature)].id);
            else lineage.insert("unknown");
        }
        QString lineageText;for(const auto& id:lineage) lineageText+=id+';';
        const auto source=(bodyId+'|'+QString::number(static_cast<int>(curve.GetType()))+'|'
                           +QString::number(length,'g',17)+'|'+lineageText+'|'+canonical).toUtf8();
        const auto id=QString::fromLatin1(QCryptographicHash::hash(source,QCryptographicHash::Sha256).toHex());
        auto displaySamples=fingerprintSamples;
        if(displayDeflection) {
            GCPnts_QuasiUniformDeflection sampler(curve,*displayDeflection,first,last);
            if(!sampler.IsDone()||sampler.NbPoints()<2) fail("Could not tessellate a selectable CAD edge.");
            displaySamples.clear();displaySamples.reserve(static_cast<size_t>(sampler.NbPoints()));
            for(Standard_Integer i=1;i<=sampler.NbPoints();++i) {
                const auto sample=point(sampler.Value(i));
                if(!sample.finite()) fail("Selectable CAD edge exceeds the supported numeric range.");
                displaySamples.push_back(sample);
            }
        }
        records.push_back({id,edge,{id,bodyId,std::move(displaySamples),length}});
    }
    std::map<QString,int> counts;for(const auto& record:records)++counts[record.id];
    for(auto& record:records) if(counts[record.id]!=1) {record.id.clear();record.result.id.clear();}
    return records;
}

TopoDS_Shape applyFillet(const TopoDS_Shape& current,const CadFeature& feature,int featureIndex,
                         std::vector<OwnedFace>& owners,const QString& bodyId,const std::vector<CadFeature>& features) {
    if(!std::isfinite(feature.filletRadius)||feature.filletRadius<=Precision::Confusion())
        fail("Fillet radius must be finite and greater than modeling precision.");
    if(feature.edgeIds.empty()) fail("A fillet requires at least one selected edge.");
    const auto available=edgeRecords(current,bodyId,owners,features);std::set<QString> selected;
    BRepFilletAPI_MakeFillet operation(current);
    for(const auto& id:feature.edgeIds) {
        if(id.isEmpty()||!selected.insert(id).second) fail("Fillet edge identifiers must be nonempty and unique.");
        const auto match=std::find_if(available.begin(),available.end(),[&](const auto& edge){return edge.id==id;});
        if(match==available.end()) fail("A selected fillet edge is stale, missing, or ambiguous after regeneration.");
        operation.Add(feature.filletRadius,match->edge);
    }
    operation.Build();if(!operation.IsDone()) fail("Selected CAD edges could not be filleted with the requested radius.");
    const auto result=operation.Shape();
    if(result.IsNull()||solidCount(result)!=1||!BRepCheck_Analyzer(result).IsValid()) fail("Edge fillet produced an invalid body.");
    owners=filletOwners(operation,result,owners,featureIndex);return result;
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

OwnedShape fuseOwned(const OwnedShape& base,const std::array<const OwnedShape*,2>& toolsToFuse) {
    TopTools_ListOfShape arguments,tools;arguments.Append(base.shape);
    std::vector<OwnedFace> toolOwners;std::vector<TopoDS_Shape> prior=base.sectionEdges;
    for(const auto* item:toolsToFuse) {
        tools.Append(item->shape);
        toolOwners.insert(toolOwners.end(),item->owners.begin(),item->owners.end());
        prior.insert(prior.end(),item->sectionEdges.begin(),item->sectionEdges.end());
    }
    BRepAlgoAPI_Fuse operation;operation.SetArguments(arguments);operation.SetTools(tools);
    operation.SetNonDestructive(true);operation.Build();
    if(!operation.IsDone()||operation.HasErrors()) fail("Vessel junction boolean operation failed.");
    auto shape=operation.Shape();
    if(shape.IsNull()||solidCount(shape)==0||!BRepCheck_Analyzer(shape).IsValid())
        fail("Vessel junction boolean produced an invalid result.");
    OwnedShape result;result.shape=shape;
    result.owners=mergedOwners(operation,shape,base.owners,toolOwners);
    result.sectionEdges=mergedSectionEdges(operation,prior);
    result.maximumSeamAngle=base.maximumSeamAngle;result.guide=base.guide;
    for(const auto* item:toolsToFuse) {
        result.maximumSeamAngle=std::max(result.maximumSeamAngle,item->maximumSeamAngle);
        result.guide.insert(result.guide.end(),item->guide.begin(),item->guide.end());
    }
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

struct SplineBounds {
    Vec3 minimum{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),
                 std::numeric_limits<double>::infinity()};
    Vec3 maximum{-std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity(),
                 -std::numeric_limits<double>::infinity()};

    bool containsWithin(Vec3 value,double tolerance) const {
        auto separated=[&](double value,double low,double high) {
            return (value<low&&low-value>tolerance)||(value>high&&value-high>tolerance);
        };
        return !separated(value.x,minimum.x,maximum.x)&&!separated(value.y,minimum.y,maximum.y)
               &&!separated(value.z,minimum.z,maximum.z);
    }
};

struct PreparedSpline {
    CurveRange range;
    std::vector<double> parameters;
    SplineBounds bounds;
};

PreparedSpline prepareSpline(const Curve& source) {
    PreparedSpline prepared;prepared.parameters=interpolationParameters(source.points);
    prepared.range=interpolatePoints(source.points);
    const auto spline=Handle(Geom_BSplineCurve)::DownCast(prepared.range.curve);
    if(spline.IsNull()) fail("Centerline interpolation did not produce a bounded B-spline.");
    for(Standard_Integer i=1;i<=spline->NbPoles();++i) {
        const auto pole=point(spline->Pole(i));
        if(!pole.finite()) fail("Centerline interpolation exceeds the supported numeric range.");
        prepared.bounds.minimum.x=std::min(prepared.bounds.minimum.x,pole.x);
        prepared.bounds.minimum.y=std::min(prepared.bounds.minimum.y,pole.y);
        prepared.bounds.minimum.z=std::min(prepared.bounds.minimum.z,pole.z);
        prepared.bounds.maximum.x=std::max(prepared.bounds.maximum.x,pole.x);
        prepared.bounds.maximum.y=std::max(prepared.bounds.maximum.y,pole.y);
        prepared.bounds.maximum.z=std::max(prepared.bounds.maximum.z,pole.z);
    }
    return prepared;
}

std::optional<SplineConnection> splineConnection(const Curve& source,const PreparedSpline& prepared,
                                                 size_t curveIndex,Vec3 endpoint,double tolerance) {
    if(!prepared.bounds.containsWithin(endpoint,tolerance)) return std::nullopt;
    std::optional<SplineConnection> best;
    for(size_t i=0;i<source.points.size();++i) {
        const auto distance=(source.points[i]-endpoint).length();
        if(std::isfinite(distance)&&distance<=tolerance
           &&(!best||distance<best->distance))
            best=SplineConnection{curveIndex,prepared.parameters[i],source.points[i],distance,true};
    }
    GeomAPI_ProjectPointOnCurve projection(point(endpoint),prepared.range.curve,
                                           prepared.range.first,prepared.range.last);
    if(projection.NbPoints()>0) {
        const auto distance=projection.LowerDistance();
        if(std::isfinite(distance)&&distance<=tolerance
           &&(!best||distance<best->distance))
            best=SplineConnection{curveIndex,projection.LowerDistanceParameter(),
                                  point(projection.NearestPoint()),distance,false};
    }
    return best;
}

struct SplineInsertion { size_t curve=0,index=0; double parameter=0; Vec3 point; };

void insertSplinePoints(std::vector<Curve>& curves,std::vector<SplineInsertion>& additions,double tolerance) {
    std::sort(additions.begin(),additions.end(),[](const auto& a,const auto& b) {
        if(a.curve!=b.curve) return a.curve<b.curve;
        if(a.index!=b.index) return a.index>b.index;
        return a.parameter>b.parameter;
    });
    std::vector<SplineInsertion> applied;
    for(const auto& addition:additions) {
        if(std::any_of(applied.begin(),applied.end(),[&](const auto& prior) {
            return prior.curve==addition.curve&&closeTo(prior.point,addition.point,tolerance);
        })) continue;
        auto& points=curves.at(addition.curve).points;
        points.insert(points.begin()+static_cast<ptrdiff_t>(addition.index),addition.point);
        applied.push_back(addition);
    }
}

struct BranchSourceRange {
    const Curve* source=nullptr;
    size_t start=0,finish=0;
    int direction=1;
};

std::optional<BranchSourceRange> branchSourceRange(const Network& network,const Branch& branch) {
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
            return BranchSourceRange{&source,start,static_cast<size_t>(finish),directionSign};
        }
    }
    return std::nullopt;
}

CurveRange branchCurve(const Branch& branch,const std::optional<BranchSourceRange>& sourceRange) {
    if(sourceRange) {
        const auto& source=*sourceRange->source;auto full=interpolatePoints(source.points);
        // Recreate the explicit centripetal parameters used by interpolatePoints.
        std::vector<double> parameters(source.points.size());
        for(size_t i=1;i<source.points.size();++i) parameters[i]=parameters[i-1]+std::sqrt((source.points[i]-source.points[i-1]).length());
        if(sourceRange->direction>0) return {full.curve,parameters[sourceRange->start],parameters[sourceRange->finish]};
        auto reversed=Handle(Geom_Curve)::DownCast(full.curve->Reversed());
        return {reversed,full.curve->ReversedParameter(parameters[sourceRange->start]),
                full.curve->ReversedParameter(parameters[sourceRange->finish])};
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

BranchGeometry buildBranchGeometry(const Network& network,const Branch& branch,int index,const CurveRange& range,
                                   bool exactTwoPointLine) {
    if(!std::isfinite(branch.diameter)||branch.diameter<=2*Precision::Confusion())
        fail("Assigned vessel diameter is below modeling precision or nonfinite.");
    GeomAdaptor_Curve adaptor(range.curve,range.first,range.last);
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
    const auto radius=branch.diameter/2;
    const gp_Dir sweepDirection(startTangent);
    TopoDS_Shape shape;
    if(exactTwoPointLine) {
        const gp_Vec axis(startPoint,endPoint);const auto height=axis.Magnitude();
        if(!std::isfinite(height)||height<=Precision::Confusion()) fail("Vessel centerline has no usable swept length.");
        BRepPrimAPI_MakeCylinder cylinder(gp_Ax2(startPoint,gp_Dir(axis)),radius,height);
        cylinder.Build();if(!cylinder.IsDone()) fail("Could not construct the straight vessel branch.");
        shape=cylinder.Shape();
    } else {
        BRepBuilderAPI_MakeEdge edge(range.curve,first,last);if(!edge.IsDone()) fail("Could not trim the vessel centerline.");
        BRepBuilderAPI_MakeWire spine(edge.Edge());if(!spine.IsDone()) fail("Could not construct the vessel sweep path.");
        BRepOffsetAPI_MakePipe pipe(spine.Wire(),circleFace(startPoint,sweepDirection,radius),GeomFill_IsCorrectedFrenet,true);
        if(!pipe.IsDone()) fail("Could not sweep the vessel branch.");
        shape=pipe.Shape();
    }
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

double distanceToTrimmedSurface(BRepExtrema_DistShapeShape& distance,gp_Pnt sample) {
    const auto vertex=BRepBuilderAPI_MakeVertex(sample).Vertex();
    distance.LoadS1(vertex);distance.Perform();
    if(!distance.IsDone()||distance.NbSolution()==0) return std::numeric_limits<double>::infinity();
    return distance.Value();
}

double mirrorSymmetryError(const TopoDS_Shape& shape,gp_Pnt origin,gp_Dir planeNormal) {
    double maximum=0;int samples=0;
    BRepExtrema_DistShapeShape distance;distance.LoadS2(shape);
    constexpr std::array<double,4> fractions{.125,.375,.625,.875};
    for(TopExp_Explorer explorer(shape,TopAbs_FACE);explorer.More();explorer.Next()) {
        const auto face=TopoDS::Face(explorer.Current());const auto surface=BRep_Tool::Surface(face);
        if(surface.IsNull()) continue;
        Standard_Real uMin=0,uMax=0,vMin=0,vMax=0;BRepTools::UVBounds(face,uMin,uMax,vMin,vMax);
        if(!std::isfinite(uMin)||!std::isfinite(uMax)||!std::isfinite(vMin)||!std::isfinite(vMax)) continue;
        for(const auto fu:fractions)for(const auto fv:fractions) {
            const auto u=uMin+(uMax-uMin)*fu,v=vMin+(vMax-vMin)*fv;
            BRepClass_FaceClassifier classifier(face,gp_Pnt2d(u,v),Precision::Confusion()*10);
            if(classifier.State()!=TopAbs_IN&&classifier.State()!=TopAbs_ON) continue;
            const auto value=surface->Value(u,v);const gp_Vec offset(origin,value);
            const auto reflected=value.Translated(gp_Vec(planeNormal)*(-2*offset.Dot(gp_Vec(planeNormal))));
            const auto valueDistance=distanceToTrimmedSurface(distance,reflected);
            if(!std::isfinite(valueDistance)) fail("Could not validate reflected vessel-junction surface samples.");
            maximum=std::max(maximum,valueDistance);++samples;
        }
    }
    if(samples<8) fail("Vessel junction has too few usable surface samples for symmetry validation.");
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
    if(rings.size()!=3) fail("Only three-arm symmetric vessel junctions are currently supported.");
    double minRadius=std::numeric_limits<double>::infinity();
    for(const auto& ring:rings) minRadius=std::min(minRadius,ring.radius);
    if(requestedRadius>0&&requestedRadius>=minRadius)
        fail("Requested junction radius must be smaller than every incident vessel radius.");
    std::array<gp_Dir,3> directions;
    for(size_t i=0;i<rings.size();++i) {
        const auto offset=gp_Vec(point(node),rings[i].center);
        if(offset.SquareMagnitude()<=Precision::SquareConfusion()) fail("Junction setback is too short to form a central blend.");
        if(offset.Magnitude()<rings[i].radius*1.25) fail("Junction setback is too short to form a smooth central blend.");
        directions[i]=gp_Dir(directedTangent(rings[i],true,true).Reversed());
    }
    const auto coplanarity=std::abs(gp_Vec(directions[0]).Dot(gp_Vec(directions[1]).Crossed(gp_Vec(directions[2]))));
    if(coplanarity>1e-3) fail("A smooth complete vessel junction currently requires coplanar incident arms.");
    int mother=-1;
    for(int candidate=0;candidate<3&&mother<0;++candidate) {
        const int first=(candidate+1)%3,second=(candidate+2)%3;
        const auto daughterTolerance=std::max(Precision::Confusion()*10,rings[first].radius*1e-6);
        if(std::abs(rings[first].radius-rings[second].radius)>daughterTolerance
           ||rings[candidate].radius+daughterTolerance<rings[first].radius
           ||rings[candidate].radius>rings[first].radius*2) continue;
        const auto firstDot=directions[candidate].Dot(directions[first]);
        const auto secondDot=directions[candidate].Dot(directions[second]);
        const auto daughterDot=directions[first].Dot(directions[second]);
        auto sum=gp_Vec(directions[first])+gp_Vec(directions[second]);
        if(firstDot>=-.1||secondDot>=-.1||daughterDot>=.999999||std::abs(firstDot-secondDot)>.01
           ||sum.SquareMagnitude()<=Precision::SquareConfusion()) continue;
        sum.Normalize();
        if(sum.Dot(gp_Vec(directions[candidate]).Reversed())<.999) continue;
        mother=candidate;
    }
    if(mother<0)
        fail(QString("A smooth complete vessel junction requires equal daughter diameters mirrored about the mother-vessel axis. "
                     "Directions were (%1,%2), (%3,%4), (%5,%6).")
             .arg(directions[0].X(),0,'g',6).arg(directions[0].Y(),0,'g',6)
             .arg(directions[1].X(),0,'g',6).arg(directions[1].Y(),0,'g',6)
             .arg(directions[2].X(),0,'g',6).arg(directions[2].Y(),0,'g',6));

    const auto owner=-(nodeIndex+1);std::array<OwnedShape,3> arms;
    for(size_t i=0;i<rings.size();++i) {
        const auto& ring=rings[i];
        const auto edge=directedGuideEdge(ring,true);
        BRepBuilderAPI_MakeWire wire(edge);
        if(!wire.IsDone()) fail("Could not construct the exact vessel junction arm guide.");
        auto arm=guidedSweep(wire.Wire(),ring.center,gp_Dir(directedTangent(ring,true,false)),
                             ring.radius,ring.radius,edgeLength(edge),owner);
        arm.maximumSeamAngle=seamAngle(ring.branchShape,arm.shape,ring.center,ring.towardNode,ring.radius);
        if(!std::isfinite(arm.maximumSeamAngle)||arm.maximumSeamAngle>1e-4)
            fail("Centerline-guided junction arm is not tangent-continuous at its branch seam.");
        arm.guide=guideSamples(ring,true);
        arms[i]=std::move(arm);
    }
    const int first=(mother+1)%3,second=(mother+2)%3;
    const gp_Dir bifurcationNormal(gp_Vec(directions[first]).Crossed(gp_Vec(directions[second])));
    const gp_Dir symmetryPlaneNormal(gp_Vec(bifurcationNormal).Crossed(gp_Vec(directions[mother])));

    // Boolean fillet topology can otherwise depend on the junction's world
    // rotation. Work in a canonical local frame and transform the validated
    // result back; rigid transforms preserve the exact guide and seam angles.
    gp_Trsf toCanonical;toCanonical.SetDisplacement(
        gp_Ax3(point(node),bifurcationNormal,directions[mother]),gp_Ax3());
    for(auto& arm:arms) {
        const auto maximumSeamAngle=arm.maximumSeamAngle;auto guide=arm.guide;
        BRepBuilderAPI_Transform transform(arm.shape,toCanonical,true);
        if(!transform.IsDone()) fail("Could not normalize vessel junction geometry for robust blending.");
        arm=ownedShape(transform.Shape(),owner);arm.maximumSeamAngle=maximumSeamAngle;arm.guide=std::move(guide);
    }
    // Submit both mirrored daughters in one boolean operation. Sequential
    // fuses can choose different approximation histories for otherwise
    // identical arms and leave a measurably asymmetric rounded junction.
    auto core=fuseOwned(arms[mother],{&arms[first],&arms[second]});
    if(solidCount(core.shape)!=1) fail("Junction arms did not form one joined solid.");
    // Keep the automatic crotch round conservative. Larger defaults can make
    // OCCT's odd section-edge topology choose an asymmetric solution even
    // when the three-arm union itself is symmetric to modeling precision.
    const auto blendRadius=requestedRadius>0?requestedRadius:minRadius*.05;
    const auto canonicalNode=point(node).Transformed(toCanonical);
    const auto canonicalSymmetryNormal=symmetryPlaneNormal.Transformed(toCanonical);
    const auto sectionEdgeCount=core.sectionEdges.size();
    const auto unroundedCore=core.shape;
    {
        BRepFilletAPI_MakeFillet fillet(core.shape);int count=0;
        for(const auto& edge:core.sectionEdges) if(edge.ShapeType()==TopAbs_EDGE) {
            fillet.Add(blendRadius,TopoDS::Edge(edge));++count;
        }
        if(count==0) fail("Junction construction produced no internal intersection edges to round.");
        fillet.Build();
        if(!fillet.IsDone()) fail("Smooth junction blend could not be built for the incident arms.");
        auto rounded=fillet.Shape();
        if(rounded.IsNull()||solidCount(rounded)!=1||!BRepCheck_Analyzer(rounded).IsValid())
            fail("Smooth junction blend produced an invalid solid.");
        const auto maximumSeamAngle=core.maximumSeamAngle;auto guide=std::move(core.guide);
        core=ownedShape(rounded,owner);core.maximumSeamAngle=maximumSeamAngle;core.guide=std::move(guide);
    }
    const auto symmetryError=mirrorSymmetryError(core.shape,canonicalNode,canonicalSymmetryNormal);
    const auto symmetryTolerance=std::max(Precision::Confusion()*100,minRadius*5e-5);
    if(symmetryError>symmetryTolerance) {
        // The unrounded-union value is useful failure evidence but expensive;
        // successful junctions need only validate their final actual surface.
        const auto unionSymmetryError=mirrorSymmetryError(unroundedCore,canonicalNode,canonicalSymmetryNormal);
        fail(QString("Vessel junction surface is not mirror-symmetric within modeling tolerance "
                     "(union error %1, blended error %2, tolerance %3, section edges %4).")
             .arg(unionSymmetryError,0,'g',8).arg(symmetryError,0,'g',8)
             .arg(symmetryTolerance,0,'g',8).arg(sectionEdgeCount));
    }
    const auto maximumSeamAngle=core.maximumSeamAngle;auto guide=std::move(core.guide);
    BRepBuilderAPI_Transform restore(core.shape,toCanonical.Inverted(),true);
    if(!restore.IsDone()||restore.Shape().IsNull()||solidCount(restore.Shape())!=1
       ||!BRepCheck_Analyzer(restore.Shape()).IsValid())
        fail("Could not restore the blended vessel junction to model coordinates.");
    core=ownedShape(restore.Shape(),owner);core.maximumSeamAngle=maximumSeamAngle;core.guide=std::move(guide);
    return core;
}

QString failureText(const std::exception& error) { return QString::fromUtf8(error.what()); }
QString failureText(const Standard_Failure& error) {
    const auto detail=error.GetMessageString();return detail&&*detail?QString::fromUtf8(detail):QString("Open CASCADE operation failed.");
}

struct CachedBranchArtifact {
    QByteArray digest;
    std::vector<Vec3> centerline;
    VesselItemResult status;
    std::optional<BranchGeometry> geometry;
    bool standalone=false;
    std::vector<Triangle> triangles;
    double volume=0;
};

struct CachedJunctionArtifact {
    std::optional<OwnedShape> connector;
    QString failure;
};

struct BranchCacheEntry {
    std::string key;
    std::shared_ptr<const CachedBranchArtifact> artifact;
    size_t cost=0;
};

struct VesselResultCacheEntry {
    Network network;
    double deflection=0,junctionRadius=0;
    VesselResult result;
};

struct VesselCacheState {
    using JunctionList=std::list<std::pair<std::string,std::shared_ptr<const CachedJunctionArtifact>>>;
    std::list<BranchCacheEntry> branches;
    std::unordered_map<std::string,std::list<BranchCacheEntry>::iterator> branchIndex;
    size_t branchCost=0;
    JunctionList junctions;
    std::unordered_map<std::string,JunctionList::iterator> junctionIndex;
    std::vector<VesselResultCacheEntry> exactResults;
};

VesselCacheState& vesselCacheState() { static VesselCacheState state;return state; }
std::mutex& vesselCacheMutex() { static std::mutex mutex;return mutex; }

template<class T> void appendExact(std::string& key,const T& value) {
    static_assert(std::is_trivially_copyable_v<T>);
    key.append(reinterpret_cast<const char*>(&value),sizeof(value));
}

void appendExact(std::string& key,Vec3 value) {
    appendExact(key,value.x);appendExact(key,value.y);appendExact(key,value.z);
}

std::string branchArtifactKey(const Network& network,const Branch& branch,size_t index,double deflection,
                              const std::optional<BranchSourceRange>& sourceRange) {
    std::string key;key.reserve(160+branch.points.size()*sizeof(Vec3)
                                +(sourceRange?sourceRange->source->points.size()*sizeof(Vec3):0));
    constexpr uint32_t version=1;appendExact(key,version);appendExact(key,index);appendExact(key,deflection);
    appendExact(key,network.tolerance);appendExact(key,branch.start);appendExact(key,branch.end);
    appendExact(key,network.nodes[static_cast<size_t>(branch.start)].degree);
    appendExact(key,network.nodes[static_cast<size_t>(branch.end)].degree);
    appendExact(key,network.nodes[static_cast<size_t>(branch.start)].point);
    appendExact(key,network.nodes[static_cast<size_t>(branch.end)].point);
    appendExact(key,branch.diameter);appendExact(key,branch.startSetback);appendExact(key,branch.endSetback);
    const auto branchCount=branch.points.size();appendExact(key,branchCount);
    for(const auto value:branch.points)appendExact(key,value);
    const bool supported=sourceRange.has_value();appendExact(key,supported);
    if(sourceRange) {
        appendExact(key,sourceRange->start);appendExact(key,sourceRange->finish);appendExact(key,sourceRange->direction);
        const auto sourceCount=sourceRange->source->points.size();appendExact(key,sourceCount);
        for(const auto value:sourceRange->source->points)appendExact(key,value);
    }
    return key;
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

static Network connectCenterlinesWithSplineConnectionsImpl(const std::vector<Curve>& curves,double tolerance,
                                                           size_t firstConnectionCurve) {
    try {
        if(!std::isfinite(tolerance)||tolerance<=0)
            fail("Connection tolerance must be positive and finite.");
        if(curves.empty()) { Network empty;empty.tolerance=tolerance;return empty; }
        size_t totalPoints=0;std::set<QString> ids;
        for(const auto& curve:curves) {
            if(curve.id.isEmpty()||!ids.insert(curve.id).second)
                fail("Centerline identifiers must be nonempty and unique.");
            if(curve.points.size()<2) fail("A centerline requires at least two points.");
            totalPoints+=curve.points.size();if(totalPoints>50000) fail("This development build supports at most 50,000 input points.");
            for(const auto& value:curve.points) if(!value.finite()) fail("Centerline coordinates must be finite.");
        }

        std::vector<Curve> enriched;enriched.reserve(curves.size());
        std::vector<std::optional<PreparedSpline>> prepared;prepared.reserve(curves.size());
        auto splineAt=[&](size_t index)->const PreparedSpline& {
            if(!prepared[index]) prepared[index]=prepareSpline(enriched[index]);
            return *prepared[index];
        };
        if(firstConnectionCurve>curves.size()) fail("Spline connection batch prefix is invalid.");
        for(size_t inputIndex=0;inputIndex<curves.size();++inputIndex) {
            const auto& input=curves[inputIndex];
            if(inputIndex<firstConnectionCurve) {
                enriched.push_back(input);prepared.push_back(std::nullopt);continue;
            }
            auto adjusted=input;
            std::vector<SplineInsertion> existingInsertions,newInsertions;

            // Match the established point-first ordering: a new endpoint is
            // snapped to the nearest earlier exact interpolant. The same
            // projected point is inserted into that source curve.
            for(const auto endpointIndex:{size_t(0),input.points.size()-1}) {
                std::optional<SplineConnection> best;
                for(size_t curveIndex=0;curveIndex<enriched.size();++curveIndex) {
                    const auto candidate=splineConnection(enriched[curveIndex],splineAt(curveIndex),
                                                          curveIndex,input.points[endpointIndex],tolerance);
                    if(candidate&&(!best||candidate->distance<best->distance)) best=candidate;
                }
                if(!best) continue;
                adjusted.points[endpointIndex]=best->point;
                if(!best->sampled) {
                    const auto& parameters=splineAt(best->curve).parameters;
                    const auto at=static_cast<size_t>(std::upper_bound(parameters.begin(),parameters.end(),best->parameter)-parameters.begin());
                    if(at>0&&at<parameters.size())
                        existingInsertions.push_back({best->curve,at,best->parameter,best->point});
                }
            }
            if(!existingInsertions.empty()) {
                insertSplinePoints(enriched,existingInsertions,tolerance);
                for(const auto& insertion:existingInsertions) prepared[insertion.curve].reset();
            }

            // Conversely, an established endpoint landing on the new exact
            // interpolant remains fixed and is inserted into the new source.
            // Use the original new curve here, matching the prior incremental
            // behavior before endpoint snapping changes its interpolation.
            auto inputSpline=prepareSpline(input);
            for(const auto& source:enriched) {
                for(const auto endpointIndex:{size_t(0),source.points.size()-1}) {
                    const auto hit=splineConnection(input,inputSpline,0,source.points[endpointIndex],tolerance);
                    if(!hit||hit->sampled) continue;
                    const auto at=static_cast<size_t>(std::upper_bound(inputSpline.parameters.begin(),inputSpline.parameters.end(),hit->parameter)
                                                      -inputSpline.parameters.begin());
                    if(at>0&&at<inputSpline.parameters.size())
                        newInsertions.push_back({0,at,hit->parameter,source.points[endpointIndex]});
                }
            }
            if(!newInsertions.empty()) {
                std::vector<Curve> holder{adjusted};insertSplinePoints(holder,newInsertions,tolerance);
                adjusted=std::move(holder.front());
            }
            bool unchanged=adjusted.points.size()==input.points.size();
            for(size_t i=0;unchanged&&i<input.points.size();++i)
                unchanged=adjusted.points[i].x==input.points[i].x&&adjusted.points[i].y==input.points[i].y
                          &&adjusted.points[i].z==input.points[i].z;
            enriched.push_back(std::move(adjusted));
            if(unchanged) prepared.push_back(std::move(inputSpline)); else prepared.push_back(std::nullopt);
        }
        return buildNetwork(enriched,tolerance);
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE operation failed.");
    }
}

Network connectCenterlinesWithSplineConnections(const std::vector<Curve>& curves,double tolerance) {
    return connectCenterlinesWithSplineConnectionsImpl(curves,tolerance,0);
}

Network addCenterlineWithSplineConnections(const Network& previous,const Curve& curve) {
    auto curves=previous.curves;curves.push_back(curve);
    auto exact=connectCenterlinesWithSplineConnectionsImpl(curves,previous.tolerance,previous.curves.size());
    for(auto& branch:exact.branches) if(branch.diameter==0) for(const auto& old:previous.branches) {
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
    return exact;
}

static CadResult buildCadImpl(const CadModel& model,double deflection) {
    if(!std::isfinite(deflection)||deflection<1e-4||deflection>1.0)
        fail("CAD deflection must be between 0.0001 and 1.");
    std::set<QString> sketchIds,featureIds;
    for(const auto& sketch:model.sketches) {
        if(sketch.id.isEmpty()||!sketchIds.insert(sketch.id).second) fail("Sketch identifiers must be nonempty and unique.");
    }
    if(model.features.empty()) return {};
    struct BodyState { QString id; TopoDS_Shape shape; std::vector<OwnedFace> owners; };
    std::vector<BodyState> bodies;
    auto targetIndex=[&](const QString& requested,bool requireExplicit) {
        if(!requested.isEmpty()) {
            const auto found=std::find_if(bodies.begin(),bodies.end(),[&](const auto& body){return body.id==requested;});
            if(found==bodies.end()) fail("CAD feature refers to a missing or deleted target body.");
            return static_cast<size_t>(found-bodies.begin());
        }
        if(requireExplicit||bodies.size()!=1) fail("CAD feature requires an explicit target body when the model does not contain exactly one body.");
        return size_t(0);
    };
    for(size_t i=0;i<model.features.size();++i) {
        const auto& feature=model.features[i];
        if(feature.id.isEmpty()||feature.id=="vessels"||!featureIds.insert(feature.id).second)
            fail("CAD feature identifiers must be nonempty, unique, and cannot use the reserved vessels identifier.");
        if(!std::isfinite(feature.depth)||!std::isfinite(feature.secondDepth)||!std::isfinite(feature.startOffset)
           ||!std::isfinite(feature.filletRadius)||feature.secondDepth<0||feature.filletRadius<0)
            fail("CAD feature parameters must be finite and nonnegative where required.");
        if(feature.operation!=CadOperation::Boss&&feature.operation!=CadOperation::Cut
           &&feature.operation!=CadOperation::Fillet&&feature.operation!=CadOperation::DeleteBody)
            fail("Unknown CAD feature operation.");
        if(feature.bodyMode!=CadBodyMode::Merge&&feature.bodyMode!=CadBodyMode::NewBody) fail("Unknown CAD body mode.");
        if(feature.operation==CadOperation::DeleteBody) {
            if(feature.sketch!=-1||feature.bodyMode!=CadBodyMode::Merge||feature.targetBody.isEmpty()) fail("Delete Body requires one explicit target and no sketch.");
            const auto target=targetIndex(feature.targetBody,true);bodies.erase(bodies.begin()+static_cast<ptrdiff_t>(target));continue;
        }
        if(feature.operation==CadOperation::Fillet) {
            if(feature.sketch!=-1||feature.bodyMode!=CadBodyMode::Merge||feature.targetBody.isEmpty()) fail("A fillet requires one explicit target body and no sketch.");
            const auto target=targetIndex(feature.targetBody,true);auto& body=bodies[target];
            body.shape=applyFillet(body.shape,feature,static_cast<int>(i),body.owners,body.id,model.features);continue;
        }
        if(feature.sketch<0||feature.sketch>=static_cast<int>(model.sketches.size())) fail("CAD feature refers to an invalid sketch.");
        if(feature.extent!=CadExtent::Blind&&feature.extent!=CadExtent::ThroughAll
           &&feature.extent!=CadExtent::MidPlane&&feature.extent!=CadExtent::TwoDirections) fail("Unknown extrusion extent.");
        if(feature.operation==CadOperation::Boss&&feature.extent==CadExtent::ThroughAll) fail("Through All is only supported for cuts.");
        if(feature.operation==CadOperation::Cut&&feature.bodyMode==CadBodyMode::NewBody) fail("A cut cannot create a new body.");
        if(feature.operation==CadOperation::Boss&&feature.bodyMode==CadBodyMode::NewBody) {
            if(!feature.targetBody.isEmpty()) fail("A New Body boss cannot also specify a target body.");
            const auto tool=prismFor(model.sketches[feature.sketch],feature,{});
            BodyState body{feature.id,tool,{}};
            for(TopExp_Explorer explorer(tool,TopAbs_FACE);explorer.More();explorer.Next()) body.owners.push_back({explorer.Current(),static_cast<int>(i)});
            bodies.push_back(std::move(body));continue;
        }
        if(feature.operation==CadOperation::Boss&&bodies.empty()) {
            if(!feature.targetBody.isEmpty()) fail("The first body-creating feature cannot target a body that does not exist.");
            const auto tool=prismFor(model.sketches[feature.sketch],feature,{});
            BodyState body{feature.id,tool,{}};
            for(TopExp_Explorer explorer(tool,TopAbs_FACE);explorer.More();explorer.Next()) body.owners.push_back({explorer.Current(),static_cast<int>(i)});
            bodies.push_back(std::move(body));continue;
        }
        const auto target=targetIndex(feature.targetBody,bodies.size()!=1);auto& body=bodies[target];
        const auto tool=prismFor(model.sketches[feature.sketch],feature,body.shape);
        body.shape=applyFeature(body.shape,tool,feature,static_cast<int>(i),body.owners);
    }
    CadResult result;
    if(bodies.empty()) return result;
    BRep_Builder compoundBuilder;TopoDS_Compound compound;compoundBuilder.MakeCompound(compound);
    for(const auto& body:bodies) {
        const auto volume=volumeOf(body.shape);
        if(!std::isfinite(volume)||volume<=changeTolerance(volume)||solidCount(body.shape)!=1||!BRepCheck_Analyzer(body.shape).IsValid())
            fail("CAD body has no usable valid solid volume.");
        CadBodyResult output;output.id=body.id;output.volume=volume;
        output.triangles=meshShape(body.shape,deflection,body.owners);
        const auto edges=edgeRecords(body.shape,body.id,body.owners,model.features,deflection);output.edges.reserve(edges.size());
        for(const auto& edge:edges) output.edges.push_back(edge.result);
        output.nativeShape=std::static_pointer_cast<const void>(std::make_shared<TopoDS_Shape>(body.shape));
        result.volume+=volume;result.triangles.insert(result.triangles.end(),output.triangles.begin(),output.triangles.end());
        compoundBuilder.Add(compound,body.shape);result.bodies.push_back(std::move(output));
    }
    const TopoDS_Shape aggregate=bodies.size()==1?bodies.front().shape:TopoDS_Shape(compound);
    result.nativeShape=std::static_pointer_cast<const void>(std::make_shared<TopoDS_Shape>(aggregate));
    return result;
}

static bool sameCadModel(const CadModel& a,const CadModel& b) {
    if(a.sketches.size()!=b.sketches.size()||a.features.size()!=b.features.size()) return false;
    for(size_t i=0;i<a.sketches.size();++i) {
        const auto& x=a.sketches[i];const auto& y=b.sketches[i];
        if(x.id!=y.id||x.plane!=y.plane||x.offset!=y.offset||x.profile!=y.profile
           ||x.radius!=y.radius||x.points.size()!=y.points.size()) return false;
        for(size_t j=0;j<x.points.size();++j)
            if(x.points[j].x()!=y.points[j].x()||x.points[j].y()!=y.points[j].y()) return false;
    }
    for(size_t i=0;i<a.features.size();++i) {
        const auto& x=a.features[i];const auto& y=b.features[i];
        if(x.id!=y.id||x.sketch!=y.sketch||x.operation!=y.operation||x.extent!=y.extent
           ||x.depth!=y.depth||x.reversed!=y.reversed||x.secondDepth!=y.secondDepth
           ||x.startOffset!=y.startOffset||x.bodyMode!=y.bodyMode||x.targetBody!=y.targetBody
           ||x.filletRadius!=y.filletRadius||x.edgeIds!=y.edgeIds) return false;
    }
    return true;
}

CadResult buildCad(const CadModel& model,double deflection) {
    try {
        struct CacheEntry { CadModel model; double deflection=0; CadResult result; };
        static thread_local std::vector<CacheEntry> cache;
        for(size_t i=0;i<cache.size();++i) if(cache[i].deflection==deflection&&sameCadModel(cache[i].model,model)) {
            auto hit=std::move(cache[i]);cache.erase(cache.begin()+static_cast<std::ptrdiff_t>(i));
            cache.insert(cache.begin(),std::move(hit));return cache.front().result;
        }
        auto built=buildCadImpl(model,deflection);
        size_t profilePoints=0;for(const auto& sketch:model.sketches) profilePoints+=sketch.points.size();
        constexpr size_t triangleBudget=2000000;
        if(profilePoints<=10000&&built.triangles.size()<=triangleBudget) {
            size_t cachedTriangles=0;for(const auto& entry:cache) cachedTriangles+=entry.result.triangles.size();
            while(!cache.empty()&&(cache.size()>=2||cachedTriangles+built.triangles.size()>triangleBudget)) {
                cachedTriangles-=cache.back().result.triangles.size();cache.pop_back();
            }
            cache.insert(cache.begin(),{model,deflection,built});
        }
        return built;
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE operation failed.");
    }
}

static std::shared_ptr<const CachedBranchArtifact> cachedBranchArtifact(
    VesselCacheState& cache,const Network& network,const Branch& branch,size_t index,double deflection) {
    const auto sourceRange=branchSourceRange(network,branch);
    auto key=branchArtifactKey(network,branch,index,deflection,sourceRange);
    if(const auto found=cache.branchIndex.find(key);found!=cache.branchIndex.end()) {
        cache.branches.splice(cache.branches.begin(),cache.branches,found->second);
        return found->second->artifact;
    }

    auto artifact=std::make_shared<CachedBranchArtifact>();
    artifact->digest=QCryptographicHash::hash(QByteArray(key.data(),static_cast<qsizetype>(key.size())),QCryptographicHash::Sha256);
    artifact->centerline=branch.points;
    artifact->status={static_cast<int>(index),VesselBuildState::Provisional,"Diameter is unassigned."};
    artifact->standalone=network.nodes[static_cast<size_t>(branch.start)].degree<=2
                         &&network.nodes[static_cast<size_t>(branch.end)].degree<=2;
    std::optional<CurveRange> range;QString rangeFailure;
    try { range=branchCurve(branch,sourceRange); }
    catch(const Standard_Failure& error) { rangeFailure=failureText(error); }
    catch(const std::exception& error) { rangeFailure=failureText(error); }
    if(range) try { artifact->centerline=sampleCurve(*range,deflection); }
    catch(const Standard_Failure&) {}
    catch(const std::exception&) {}

    if(branch.diameter!=0) {
        if(!range) artifact->status={static_cast<int>(index),VesselBuildState::Failed,rangeFailure};
        else try {
            const bool exactTwoPointLine=branch.start!=branch.end
                &&(sourceRange?sourceRange->source->points.size()==2:branch.points.size()==2);
            artifact->geometry=buildBranchGeometry(network,branch,static_cast<int>(index),*range,exactTwoPointLine);
            artifact->status={static_cast<int>(index),VesselBuildState::Built,"Exact circular sweep built."};
        } catch(const Standard_Failure& error) {
            artifact->status={static_cast<int>(index),VesselBuildState::Failed,failureText(error)};
        } catch(const std::exception& error) {
            artifact->status={static_cast<int>(index),VesselBuildState::Failed,failureText(error)};
        }
    }
    if(artifact->standalone&&artifact->geometry) {
        artifact->volume=volumeOf(artifact->geometry->solid.shape);
        if(!std::isfinite(artifact->volume)||artifact->volume<=0)
            fail("Vessel result contains an invalid solid volume.");
        artifact->triangles=meshShape(artifact->geometry->solid.shape,deflection,artifact->geometry->solid.owners);
    }

    // Connected artifacts retain exact OCCT topology. A later component mesh
    // can also attach triangulations to shared faces, so charge a substantial
    // minimum even before those implementation-owned arrays can be counted.
    // This keeps the 2M-unit LRU useful for simple independent vessels while
    // limiting retained connected branch shapes to at most twenty.
    const auto cost=artifact->centerline.size()+artifact->triangles.size()
                    +(artifact->geometry&&!artifact->standalone?size_t(100000):size_t(0));
    constexpr size_t itemLimit=4096,pointBudget=2000000;
    if(cost<=pointBudget) {
        while(!cache.branches.empty()&&(cache.branches.size()>=itemLimit||cache.branchCost+cost>pointBudget)) {
            cache.branchCost-=cache.branches.back().cost;
            cache.branchIndex.erase(cache.branches.back().key);cache.branches.pop_back();
        }
        cache.branches.push_front({std::move(key),artifact,cost});cache.branchCost+=cost;
        cache.branchIndex.emplace(cache.branches.front().key,cache.branches.begin());
    }
    return artifact;
}

static std::string junctionArtifactKey(char kind,int node,Vec3 location,double radius,
                                       const std::vector<RingData>& rings,
                                       const std::vector<std::shared_ptr<const CachedBranchArtifact>>& branches) {
    std::string key;constexpr uint32_t version=1;appendExact(key,version);appendExact(key,kind);
    appendExact(key,node);appendExact(key,location);appendExact(key,radius);const auto count=rings.size();appendExact(key,count);
    for(const auto& ring:rings) {
        appendExact(key,ring.branch);
        const auto& digest=branches.at(static_cast<size_t>(ring.branch))->digest;
        key.append(digest.constData(),static_cast<size_t>(digest.size()));
    }
    return key;
}

template<class Builder> static OwnedShape cachedJunctionConnector(VesselCacheState& cache,std::string key,Builder&& builder) {
    std::shared_ptr<const CachedJunctionArtifact> artifact;
    if(const auto found=cache.junctionIndex.find(key);found!=cache.junctionIndex.end()) {
        cache.junctions.splice(cache.junctions.begin(),cache.junctions,found->second);artifact=found->second->second;
    } else {
        auto built=std::make_shared<CachedJunctionArtifact>();
        try { built->connector=builder(); }
        catch(const Standard_Failure& error) { built->failure=failureText(error); }
        catch(const std::exception& error) { built->failure=failureText(error); }
        artifact=std::move(built);
        // Junction shapes likewise contain shared OCCT topology whose later
        // triangulation is not represented by a portable byte count.
        constexpr size_t itemLimit=16;
        if(cache.junctions.size()>=itemLimit) {
            cache.junctionIndex.erase(cache.junctions.back().first);cache.junctions.pop_back();
        }
        cache.junctions.push_front({std::move(key),artifact});
        cache.junctionIndex.emplace(cache.junctions.front().first,cache.junctions.begin());
    }
    if(!artifact->connector) fail(artifact->failure.isEmpty()?QString("Vessel junction construction failed."):artifact->failure);
    return *artifact->connector;
}

static VesselResult buildVesselsImpl(VesselCacheState& cache,const Network& network,double deflection,double junctionRadius) {
    if(!std::isfinite(deflection)||deflection<1e-4||deflection>1.0)
        fail("Vessel deflection must be between 0.0001 and 1.");
    if(!std::isfinite(junctionRadius)||junctionRadius<0) fail("Junction radius must be nonnegative and finite.");
    if(!std::isfinite(network.tolerance)||network.tolerance<=0) fail("Network tolerance must be positive and finite.");
    VesselResult result;
    std::vector<std::optional<OwnedShape>> groups(network.branches.size());
    std::vector<int> branchGroup(network.branches.size(),-1);
    std::vector<std::optional<RingData>> startRings(network.branches.size()),endRings(network.branches.size());
    std::vector<std::shared_ptr<const CachedBranchArtifact>> branchArtifacts(network.branches.size());
    result.branches.reserve(network.branches.size());
    result.centerlines.reserve(network.branches.size());
    for(size_t i=0;i<network.branches.size();++i) {
        const auto& branch=network.branches[i];
        if(branch.start<0||branch.end<0||branch.start>=static_cast<int>(network.nodes.size())||branch.end>=static_cast<int>(network.nodes.size()))
            fail("Vessel branch endpoint index is invalid.");
        const auto artifact=cachedBranchArtifact(cache,network,branch,i,deflection);branchArtifacts[i]=artifact;
        result.centerlines.push_back(artifact->centerline);result.branches.push_back(artifact->status);
        if(artifact->geometry) {
            groups[i]=artifact->geometry->solid;branchGroup[i]=static_cast<int>(i);
            startRings[i]=artifact->geometry->startRing;endRings[i]=artifact->geometry->endRing;
        }
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
                const auto location=network.nodes[static_cast<size_t>(node)].point;
                auto transition=cachedJunctionConnector(
                    cache,junctionArtifactKey('p',node,location,0,rings,branchArtifacts),
                    [&]{return partialTransition(location,node,rings[0],rings[1]);});
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
            const auto location=network.nodes[static_cast<size_t>(node)].point;
            auto junction=cachedJunctionConnector(
                cache,junctionArtifactKey('f',node,location,junctionRadius,rings,branchArtifacts),
                [&]{return fullJunction(location,node,rings,junctionRadius);});
            const auto maximumSeamAngle=junction.maximumSeamAngle;auto guide=junction.guide;
            mergeConnector(rings,std::move(junction));
            status={node,VesselBuildState::Built,
                    junctionRadius>0?"Joined with a requested smooth, symmetry-validated centerline-guided junction blend.":"Joined with an automatic smooth, symmetry-validated centerline-guided junction blend.",
                    maximumSeamAngle,std::move(guide)};
        } catch(const Standard_Failure& error) {
            status={node,VesselBuildState::Failed,failureText(error)};
        } catch(const std::exception& error) {
            status={node,VesselBuildState::Failed,failureText(error)};
        }
        result.junctions.push_back(std::move(status));
    }

    std::vector<TopoDS_Shape> shapes;
    for(size_t i=0;i<groups.size();++i) if(auto& group=groups[i]) {
        const auto& artifact=branchArtifacts[i];
        if(artifact&&artifact->standalone&&artifact->geometry) {
            result.volume+=artifact->volume;
            result.triangles.insert(result.triangles.end(),artifact->triangles.begin(),artifact->triangles.end());
        } else {
            const auto volume=volumeOf(group->shape);
            if(!std::isfinite(volume)||volume<=0) fail("Vessel result contains an invalid solid volume.");
            result.volume+=volume;
            auto triangles=meshShape(group->shape,deflection,group->owners);
            result.triangles.insert(result.triangles.end(),triangles.begin(),triangles.end());
        }
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
    // Every standalone branch and every fused component was validated when it
    // was built. Revalidating the aggregate compound scales linearly with all
    // unchanged bodies and adds no new topological guarantee.
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
        // OCCT shapes carry shared internal handles. Serializing access makes
        // cached immutable pieces safe even if future callers use different
        // worker threads, while the UI still runs only one geometry job.
        std::lock_guard lock(vesselCacheMutex());auto& cache=vesselCacheState();
        for(size_t i=0;i<cache.exactResults.size();++i)
            if(cache.exactResults[i].deflection==deflection&&cache.exactResults[i].junctionRadius==junctionRadius
               &&sameNetwork(cache.exactResults[i].network,network)) {
                auto hit=std::move(cache.exactResults[i]);
                cache.exactResults.erase(cache.exactResults.begin()+static_cast<std::ptrdiff_t>(i));
                cache.exactResults.insert(cache.exactResults.begin(),std::move(hit));
                return cache.exactResults.front().result;
        }
        auto built=buildVesselsImpl(cache,network,deflection,junctionRadius);
        size_t sourcePoints=0;for(const auto& curve:network.curves) sourcePoints+=curve.points.size();
        constexpr size_t triangleBudget=2000000;
        if(sourcePoints<=10000&&built.triangles.size()<=triangleBudget) {
            size_t cachedTriangles=0;for(const auto& entry:cache.exactResults)cachedTriangles+=entry.result.triangles.size();
            while(!cache.exactResults.empty()&&(cache.exactResults.size()>=2||cachedTriangles+built.triangles.size()>triangleBudget)) {
                cachedTriangles-=cache.exactResults.back().result.triangles.size();cache.exactResults.pop_back();
            }
            cache.exactResults.insert(cache.exactResults.begin(),{network,deflection,junctionRadius,built});
        }
        return built;
    } catch(const Standard_Failure& error) {
        const auto detail=error.GetMessageString();
        throw std::runtime_error(detail&&*detail?std::string("Open CASCADE: ")+detail:"Open CASCADE vessel operation failed.");
    }
}

} // namespace mvcad

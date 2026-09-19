#include "cad/CadModel.h"

#include <QElapsedTimer>
#include <QTest>
#include <cmath>
#include <limits>
#include <map>
#include <numbers>
#include <set>
#include <utility>

using namespace mvcad;

namespace {

Sketch rectangle(QString id,Plane plane,double width,double height,double offset=0) {
    return {std::move(id),plane,offset,ProfileType::Rectangle,{{-width/2,-height/2},{width/2,height/2}},0};
}

Sketch rectangleAt(QString id,Plane plane,double width,double height,QPointF center,double offset=0) {
    return {std::move(id),plane,offset,ProfileType::Rectangle,
            {{center.x()-width/2,center.y()-height/2},{center.x()+width/2,center.y()+height/2}},0};
}

Sketch circle(QString id,Plane plane,double radius,QPointF center={},double offset=0) {
    return {std::move(id),plane,offset,ProfileType::Circle,{center},radius};
}

CadFeature feature(QString id,int sketch,CadOperation operation=CadOperation::Boss,
                   CadExtent extent=CadExtent::Blind,double depth=1,bool reversed=false) {
    return {std::move(id),sketch,operation,extent,depth,reversed};
}

Network yNetwork(int assigned=3,double setback=.1) {
    auto network=buildNetwork({{"a",{{0,0,0},{10,0,0}}},
                               {"b",{{0,0,0},{-5,8,0}}},
                               {"c",{{0,0,0},{-5,-8,0}}}});
    const double diameters[]{4,3,2};
    for(int i=0;i<assigned;++i) setBranchParameters(network,i,diameters[i],setback,setback);
    return network;
}

Network symmetricY(double setback=.3) {
    constexpr double rise=8.660254037844386;
    auto network=buildNetwork({{"a",{{0,0,0},{10,0,0}}},
                               {"b",{{0,0,0},{-5,rise,0}}},
                               {"c",{{0,0,0},{-5,-rise,0}}}});
    for(int i=0;i<3;++i)setBranchParameters(network,i,4,setback,setback);
    return network;
}

Network referenceStyleY(double setback=.3) {
    auto network=buildNetwork({{"mother",{{0,0,0},{0,-20,0}}},
                               {"left",{{0,0,0},{-15,15,0}}},
                               {"right",{{0,0,0},{15,15,0}}}});
    setBranchParameters(network,0,8,setback,setback);
    setBranchParameters(network,1,6,setback,setback);
    setBranchParameters(network,2,6,setback,setback);
    return network;
}

Network bifGeomReferenceY(double setback=.35) {
    const std::vector<Vec3> mother{{-32.5,0,0},{-16,0,0},{0,0,0}};
    const std::vector<Vec3> upper{{0,0,0},{8,4,0},{20,10,0},{35,22,0},{50,30,0},{67.5,30,0}};
    auto lower=upper;for(auto& point:lower)point.y=-point.y;
    auto network=buildNetwork({{"mother",mother},{"upper",upper},{"lower",lower}});
    setBranchParameters(network,0,9,setback,setback);
    setBranchParameters(network,1,7.5,setback,setback);
    setBranchParameters(network,2,7.5,setback,setback);
    return network;
}

Network independentVessels(int count) {
    std::vector<Curve> curves;curves.reserve(static_cast<size_t>(count));
    for(int i=0;i<count;++i)curves.push_back({QString("line-%1").arg(i),{{0,double(i)*4,0},{10,double(i)*4,0}}});
    auto network=buildNetwork(curves);
    for(int i=0;i<count;++i)setBranchParameters(network,i,2,0,0);
    return network;
}

Network connectedTwoJunctions() {
    const Vec3 a{0,0,0},b{0,-40,0};
    auto network=buildNetwork({{"trunk",{a,b}},
                               {"a-left",{a,{-15,15,0}}},
                               {"a-right",{a,{15,15,0}}},
                               {"b-left",{b,{-15,-55,0}}},
                               {"b-right",{b,{15,-55,0}}}});
    for(int i=0;i<int(network.branches.size());++i) {
        const auto& points=network.branches[static_cast<size_t>(i)].points;
        const bool trunk=std::any_of(points.begin(),points.end(),[](Vec3 p){return p.y==0;})
                      &&std::any_of(points.begin(),points.end(),[](Vec3 p){return p.y== -40;});
        setBranchParameters(network,i,trunk?8:6,.3,.3);
    }
    return network;
}

void near(double actual,double expected,double relative=1e-9) {
    QVERIFY2(std::abs(actual-expected)<=std::max(1.0,std::abs(expected))*relative,
             qPrintable(QString("Expected %1, got %2").arg(expected,0,'g',16).arg(actual,0,'g',16)));
}

void samePoint(Vec3 actual,Vec3 expected) {
    QCOMPARE(actual.x,expected.x);QCOMPARE(actual.y,expected.y);QCOMPARE(actual.z,expected.z);
}

bool pointNear(Vec3 actual,Vec3 expected,double tolerance=1e-8) {
    return (actual-expected).length()<=tolerance;
}

double distanceToSegment(Vec3 point,Vec3 a,Vec3 b) {
    const auto direction=b-a;const auto squared=direction.dot(direction);
    const auto parameter=squared>0?std::clamp((point-a).dot(direction)/squared,0.,1.):0.;
    return (point-(a+direction*parameter)).length();
}

} // namespace

class CadTests:public QObject {
    Q_OBJECT
private slots:
    void planeMappings(){
        samePoint(planePoint(Plane::Front,{2,3},4),{2,3,4});
        samePoint(planePoint(Plane::Top,{2,3},4),{2,4,-3});
        samePoint(planePoint(Plane::Right,{2,3},4),{4,2,3});
        samePoint(planeNormal(Plane::Front),{0,0,1});
        samePoint(planeNormal(Plane::Top),{0,1,0});
        samePoint(planeNormal(Plane::Right),{1,0,0});
    }
    void analyticRectangleVolumeAllPlanes(){
        for(auto plane:{Plane::Front,Plane::Top,Plane::Right}) {
            CadModel model{{rectangle("Sketch1",plane,4,3)}, {feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,5)}};
            const auto result=buildCad(model,.05);
            near(result.volume,60);QVERIFY(!result.triangles.empty());QVERIFY(result.nativeShape);
            for(const auto& triangle:result.triangles) QCOMPARE(triangle.branch,0);
        }
    }
    void midPlaneAndReversedPreserveVolume(){
        CadModel model{{rectangle("Sketch1",Plane::Top,4,3)},
                       {feature("Boss1",0,CadOperation::Boss,CadExtent::MidPlane,5,true)}};
        near(buildCad(model,.05).volume,60);
    }
    void unusedDraftSketchIsAllowed(){
        Sketch draft;draft.id="Draft";draft.profile=ProfileType::Polyline;
        CadModel model{{rectangle("Base",Plane::Front,4,3),draft},
                       {feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,5)}};
        near(buildCad(model,.05).volume,60);
        model.features.push_back(feature("Boss2",1));
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
    }
    void emptyAndDraftOnlyModelsHaveNoBody(){
        auto empty=buildCad({},.05);QVERIFY(empty.triangles.empty());QCOMPARE(empty.volume,0.0);QVERIFY(!empty.nativeShape);
        Sketch draft;draft.id="Draft";draft.profile=ProfileType::Polyline;
        auto draftOnly=buildCad({{draft},{}},.05);QVERIFY(draftOnly.triangles.empty());QCOMPARE(draftOnly.volume,0.0);QVERIFY(!draftOnly.nativeShape);
    }
    void throughAllCircularCut(){
        CadModel model;
        model.sketches={rectangle("Base",Plane::Front,10,10),circle("Hole",Plane::Front,2)};
        model.features={feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,10),
                        feature("Cut1",1,CadOperation::Cut,CadExtent::ThroughAll,1)};
        const auto result=buildCad(model,.02);near(result.volume,1000-40*std::numbers::pi,1e-8);
        bool baseFace=false,cutFace=false;
        for(const auto& triangle:result.triangles) {baseFace|=triangle.branch==0;cutFace|=triangle.branch==1;}
        QVERIFY(baseFace);QVERIFY(cutFace);
    }
    void closedPolylineBoss(){
        Sketch polygon{"Triangle",Plane::Right,0,ProfileType::Polyline,{{0,0},{4,0},{0,3},{0,0}},0};
        CadModel model{{polygon},{feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,2)}};
        near(buildCad(model,.05).volume,12);
    }
    void invalidProfilesAreRejected(){
        CadModel model{{rectangle("Bad",Plane::Front,0,2)},{feature("Boss1",0)}};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
        model.sketches={Sketch{"BowTie",Plane::Front,0,ProfileType::Polyline,{{0,0},{2,2},{0,2},{2,0}},0}};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
        model.sketches={circle("BadCircle",Plane::Front,-1)};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
    }
    void nonIntersectingCutIsRejected(){
        CadModel model;
        model.sketches={rectangle("Base",Plane::Front,10,10),circle("Miss",Plane::Front,2,{50,50})};
        model.features={feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,10),
                        feature("Cut1",1,CadOperation::Cut,CadExtent::ThroughAll,1)};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.02),std::runtime_error);
    }
    void disconnectedBossIsRejected(){
        CadModel model;
        model.sketches={rectangle("Base",Plane::Front,2,2),circle("Island",Plane::Front,1,{10,0})};
        model.features={feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,2),
                        feature("Boss2",1,CadOperation::Boss,CadExtent::Blind,2)};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.02),std::runtime_error);
    }
    void deflectionChangesMeshNotVolume(){
        CadModel model{{circle("Sketch1",Plane::Front,10)},
                       {feature("Boss1",0,CadOperation::Boss,CadExtent::Blind,10)}};
        const auto coarse=buildCad(model,1e-3),fine=buildCad(model,1e-4);
        near(coarse.volume,1000*std::numbers::pi,1e-10);near(fine.volume,coarse.volume,1e-12);
        QVERIFY(fine.triangles.size()>coarse.triangles.size());
        QVERIFY_EXCEPTION_THROWN(buildCad(model,1e-5),std::runtime_error);
    }
    void edgeDisplayDeflectionChangesSamplingWithoutChangingIds(){
        CadModel model{{circle("Round",Plane::Front,10)},
                       {feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,5)}};
        const auto coarse=buildCad(model,.5),fine=buildCad(model,.05);
        std::map<QString,size_t> coarseCounts,fineCounts;
        for(const auto& edge:coarse.bodies.front().edges)if(!edge.id.isEmpty())coarseCounts[edge.id]=edge.polyline.size();
        for(const auto& edge:fine.bodies.front().edges)if(!edge.id.isEmpty())fineCounts[edge.id]=edge.polyline.size();
        QVERIFY(!coarseCounts.empty());QCOMPARE(coarseCounts.size(),fineCounts.size());
        bool refined=false;
        for(const auto& [id,count]:coarseCounts){
            const auto match=fineCounts.find(id);QVERIFY(match!=fineCounts.end());
            QVERIFY(match->second>=count);refined|=match->second>count;
        }
        QVERIFY(refined);
    }
    void reservedVesselBodyIdentifierIsRejected(){
        CadModel model{{rectangle("Base",Plane::Front,2,2)},
                       {feature("vessels",0,CadOperation::Boss,CadExtent::Blind,2)}};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
    }
    void batchSplineConnectionsPreserveExactTopology(){
        const Vec3 left{2.5,7.5,0},right{7.5,7.5,0};
        const std::vector<Curve> curves{{"arch",{{0,0,0},{5,10,0},{10,0,0}}},
                                        {"connector",{left,right}},
                                        {"crossing",{{5,-2,1},{5,12,1}}}};
        const auto first=connectCenterlinesWithSplineConnections(curves,1e-6);
        const auto repeated=connectCenterlinesWithSplineConnections(curves,1e-6);
        QCOMPARE(first.components,2);QCOMPARE(first.curves.size(),curves.size());
        QCOMPARE(first.curves[0].points.size(),size_t(5));
        QVERIFY(pointNear(first.curves[0].points[1],left));
        QVERIFY(pointNear(first.curves[0].points[3],right));
        QCOMPARE(first.nodes.size(),repeated.nodes.size());QCOMPARE(first.branches.size(),repeated.branches.size());
        for(size_t i=0;i<first.curves.size();++i) {
            QCOMPARE(first.curves[i].points.size(),repeated.curves[i].points.size());
            for(size_t j=0;j<first.curves[i].points.size();++j) samePoint(first.curves[i].points[j],repeated.curves[i].points[j]);
        }
    }
    void batchTopologyScalesToOneThousandIndependentCurves(){
        std::vector<Curve> curves;curves.reserve(1000);
        for(int i=0;i<1000;++i) curves.push_back({QString("batch-%1").arg(i),{{0,double(i)*4,0},{10,double(i)*4,0}}});
        QElapsedTimer timer;timer.start();const auto network=connectCenterlinesWithSplineConnections(curves,1e-6);
        const auto elapsedMs=timer.nsecsElapsed()/1e6;
        QCOMPARE(network.curves.size(),size_t(1000));QCOMPARE(network.branches.size(),size_t(1000));QCOMPARE(network.components,1000);
        qInfo().noquote()<<QString("batch spline topology for 1000 independent curves: %1 ms").arg(elapsedMs,0,'f',3);
        QVERIFY2(elapsedMs<15000,qPrintable(QString("Batch topology took %1 ms").arg(elapsedMs,0,'f',1)));
    }
    void exactCadBuildUsesBoundedCache(){
        CadModel model{{circle("Round",Plane::Front,4)},
                       {feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,3)}};
        QElapsedTimer timer;timer.start();const auto first=buildCad(model,.05);const auto coldNs=timer.nsecsElapsed();
        timer.restart();const auto repeated=buildCad(model,.05);const auto warmNs=timer.nsecsElapsed();
        QVERIFY(first.nativeShape);QCOMPARE(first.nativeShape.get(),repeated.nativeShape.get());
        qInfo().noquote()<<QString("buildCad exact-cache benchmark: cold %1 ms, warm %2 ms")
                             .arg(coldNs/1e6,0,'f',3).arg(warmNs/1e6,0,'f',3);
        auto tinyEdit=model;tinyEdit.sketches[0].points[0].rx()+=1e-12;
        const auto tinyChanged=buildCad(tinyEdit,.05);QVERIFY(tinyChanged.nativeShape.get()!=first.nativeShape.get());
        const auto differentPrecision=buildCad(model,.02);
        QVERIFY(differentPrecision.nativeShape.get()!=first.nativeShape.get());
        model.features[0].depth=4;
        const auto changed=buildCad(model,.05);
        QVERIFY(changed.nativeShape.get()!=first.nativeShape.get());
    }
    void exactVesselBuildUsesBoundedCache(){
        auto network=buildNetwork({{"cache-probe",{{0,0,0},{12,3,0},{25,4,1}}}});
        setBranchParameters(network,0,5,.1,.1);
        QElapsedTimer timer;timer.start();const auto first=buildVessels(network,.037);const auto coldNs=timer.nsecsElapsed();
        timer.restart();const auto repeated=buildVessels(network,.037);const auto warmNs=timer.nsecsElapsed();
        QVERIFY(first.nativeShape);QCOMPARE(first.nativeShape.get(),repeated.nativeShape.get());
        QCOMPARE(first.triangles.size(),repeated.triangles.size());
        qInfo().noquote()<<QString("buildVessels exact-cache benchmark: cold %1 ms, warm %2 ms")
                             .arg(coldNs/1e6,0,'f',3).arg(warmNs/1e6,0,'f',3);
    }
    void largeIndependentVesselIncrementalBenchmark(){
        for(const int count:{100,1000}){
            auto network=independentVessels(count);QElapsedTimer timer;timer.start();
            const auto cold=buildVessels(network,.001);const auto coldNs=timer.nsecsElapsed();
            network.branches[count/2].diameter=2.25;timer.restart();
            const auto edited=buildVessels(network,.001);const auto editNs=timer.nsecsElapsed();
            auto curves=network.curves;curves[static_cast<size_t>(count/2)].points.back().x=11;
            auto pointEditedNetwork=buildNetwork(curves);
            for(int i=0;i<count;++i)setBranchParameters(pointEditedNetwork,i,i==count/2?2.25:2,0,0);
            timer.restart();const auto pointEdited=buildVessels(pointEditedNetwork,.001);const auto pointEditNs=timer.nsecsElapsed();
            timer.restart();const auto repeated=buildVessels(network,.001);const auto repeatNs=timer.nsecsElapsed();
            QCOMPARE(cold.branches.size(),size_t(count));QCOMPARE(edited.branches.size(),size_t(count));
            QCOMPARE(edited.nativeShape.get(),repeated.nativeShape.get());
            near(cold.volume,count*10*std::numbers::pi,1e-6);
            near(edited.volume,cold.volume+10*std::numbers::pi*(1.125*1.125-1),1e-6);
            QVERIFY(pointEdited.volume>edited.volume);
            qInfo().noquote()<<QString("%1 independent vessels: cold %2 ms, diameter edit %3 ms, point edit %4 ms, repeat %5 ms, %6 triangles")
                                 .arg(count).arg(coldNs/1e6,0,'f',3).arg(editNs/1e6,0,'f',3)
                                 .arg(pointEditNs/1e6,0,'f',3).arg(repeatNs/1e6,0,'f',3).arg(edited.triangles.size());
        }
    }
    void connectedJunctionIncrementalBenchmark(){
        auto network=referenceStyleY();QElapsedTimer timer;timer.start();
        const auto cold=buildVessels(network,.001);const auto coldNs=timer.nsecsElapsed();
        network.branches[0].diameter=8.1;timer.restart();
        const auto edited=buildVessels(network,.001);const auto editNs=timer.nsecsElapsed();
        timer.restart();const auto repeated=buildVessels(network,.001);const auto repeatNs=timer.nsecsElapsed();
        QVERIFY2(cold.junctions[0].state==VesselBuildState::Built,qPrintable(cold.junctions[0].message));
        QVERIFY2(edited.junctions[0].state==VesselBuildState::Built,qPrintable(edited.junctions[0].message));
        QCOMPARE(edited.nativeShape.get(),repeated.nativeShape.get());
        QVERIFY(std::abs(edited.volume-cold.volume)>1e-6);
        qInfo().noquote()<<QString("connected bifurcation: cold %1 ms, one-diameter edit %2 ms, repeat %3 ms, %4 triangles")
                             .arg(coldNs/1e6,0,'f',3).arg(editNs/1e6,0,'f',3)
                             .arg(repeatNs/1e6,0,'f',3).arg(edited.triangles.size());
    }
    void unchangedJunctionIsReusedAcrossConnectedEdit(){
        auto network=connectedTwoJunctions();QElapsedTimer timer;timer.start();
        const auto cold=buildVessels(network,.001,.15);const auto coldNs=timer.nsecsElapsed();
        QCOMPARE(cold.junctions.size(),size_t(2));
        for(const auto& junction:cold.junctions){qInfo()<<"cold junction"<<junction.index<<junction.message;
            QVERIFY2(junction.state==VesselBuildState::Built,qPrintable(junction.message));
        }
        int editedBranches=0;for(auto& branch:network.branches)
            if(std::any_of(branch.points.begin(),branch.points.end(),[](Vec3 p){return p.y< -50;}))
                {branch.diameter=6.1;++editedBranches;}
        QCOMPARE(editedBranches,2);timer.restart();
        const auto edited=buildVessels(network,.001,.15);const auto editNs=timer.nsecsElapsed();
        QCOMPARE(edited.junctions.size(),size_t(2));
        for(const auto& junction:edited.junctions)
            QVERIFY2(junction.state==VesselBuildState::Built,qPrintable(junction.message));
        QVERIFY(std::abs(edited.volume-cold.volume)>1e-6);
        qInfo().noquote()<<QString("connected two-junction network: cold %1 ms, one terminal diameter edit %2 ms, %3 triangles")
                             .arg(coldNs/1e6,0,'f',3).arg(editNs/1e6,0,'f',3).arg(edited.triangles.size());
    }
    void twoDirectionDepthsAndStartOffset(){
        CadFeature boss=feature("BodyA",0,CadOperation::Boss,CadExtent::TwoDirections,5);
        boss.secondDepth=2;boss.startOffset=10;
        const auto result=buildCad({{rectangle("Sketch1",Plane::Front,4,3)},{boss}},.05);
        near(result.volume,84);QCOMPARE(result.bodies.size(),size_t(1));QCOMPARE(result.bodies[0].id,QString("BodyA"));
        double minimum=std::numeric_limits<double>::infinity(),maximum=-minimum;
        for(const auto& triangle:result.triangles) for(const auto& point:{triangle.a,triangle.b,triangle.c}) {
            minimum=std::min(minimum,point.z);maximum=std::max(maximum,point.z);
        }
        near(minimum,8);near(maximum,15);
    }
    void independentBodiesAndTargetedCut(){
        CadModel model;
        model.sketches={rectangle("BaseA",Plane::Front,10,10),
                        rectangleAt("BaseB",Plane::Front,4,4,{20,0}),
                        circle("HoleB",Plane::Front,1,{20,0})};
        auto second=feature("BodyB",1,CadOperation::Boss,CadExtent::Blind,3);second.bodyMode=CadBodyMode::NewBody;
        auto cut=feature("CutB",2,CadOperation::Cut,CadExtent::ThroughAll,1);cut.targetBody="BodyB";
        model.features={feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,4),second,cut};
        const auto result=buildCad(model,.03);
        QCOMPARE(result.bodies.size(),size_t(2));QCOMPARE(result.bodies[0].id,QString("BodyA"));QCOMPARE(result.bodies[1].id,QString("BodyB"));
        near(result.bodies[0].volume,400);near(result.bodies[1].volume,48-3*std::numbers::pi,1e-8);
        near(result.volume,result.bodies[0].volume+result.bodies[1].volume);
        QVERIFY(result.nativeShape);QVERIFY(result.bodies[0].nativeShape);QVERIFY(result.bodies[1].nativeShape);
        QVERIFY(!result.bodies[0].edges.empty());QVERIFY(!result.bodies[1].edges.empty());
        for(const auto& edge:result.bodies[1].edges) QCOMPARE(edge.bodyId,QString("BodyB"));
    }
    void mergeRequiresTargetAndDeleteBodyUsesStableId(){
        CadModel model;
        model.sketches={rectangleAt("A",Plane::Front,4,4,{0,0}),rectangleAt("B",Plane::Front,4,4,{20,0}),
                        rectangleAt("Add",Plane::Front,4,2,{3,0})};
        auto bodyB=feature("BodyB",1,CadOperation::Boss,CadExtent::Blind,2);bodyB.bodyMode=CadBodyMode::NewBody;
        auto merge=feature("MergeA",2,CadOperation::Boss,CadExtent::Blind,2);
        model.features={feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,2),bodyB,merge};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
        model.features.back().targetBody="BodyA";
        auto merged=buildCad(model,.05);QCOMPARE(merged.bodies.size(),size_t(2));QCOMPARE(merged.bodies[0].id,QString("BodyA"));
        CadFeature remove;remove.id="DeleteB";remove.operation=CadOperation::DeleteBody;remove.targetBody="BodyB";
        model.features.push_back(remove);
        const auto remaining=buildCad(model,.05);QCOMPARE(remaining.bodies.size(),size_t(1));QCOMPARE(remaining.bodies[0].id,QString("BodyA"));
    }
    void cutCannotSilentlySplitOneLogicalBody(){
        CadModel model{{rectangle("Base",Plane::Front,10,10),rectangle("Splitter",Plane::Front,2,20)},
                       {feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,4),
                        feature("Split",1,CadOperation::Cut,CadExtent::ThroughAll,1)}};
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.05),std::runtime_error);
    }
    void stableEdgeIdsDriveRealFilletAndRejectStaleSelection(){
        CadModel model{{rectangle("Base",Plane::Front,10,8)},
                       {feature("BodyA",0,CadOperation::Boss,CadExtent::Blind,6)}};
        const auto base=buildCad(model,.05);QCOMPARE(base.bodies.size(),size_t(1));
        const auto repeated=buildCad(model,.05);QCOMPARE(base.bodies[0].edges.size(),repeated.bodies[0].edges.size());
        std::set<QString> firstIds,secondIds;for(const auto& edge:base.bodies[0].edges)firstIds.insert(edge.id);for(const auto& edge:repeated.bodies[0].edges)secondIds.insert(edge.id);QVERIFY(firstIds==secondIds);
        const auto selected=std::find_if(base.bodies[0].edges.begin(),base.bodies[0].edges.end(),[](const auto& edge){return !edge.id.isEmpty();});
        QVERIFY(selected!=base.bodies[0].edges.end());QVERIFY(selected->polyline.size()>=2);
        CadFeature fillet;fillet.id="Fillet1";fillet.operation=CadOperation::Fillet;fillet.targetBody="BodyA";
        fillet.filletRadius=.5;fillet.edgeIds={selected->id};
        model.sketches.push_back(rectangleAt("Separate",Plane::Front,2,2,{20,0}));
        auto bodyB=feature("BodyB",1,CadOperation::Boss,CadExtent::Blind,2);bodyB.bodyMode=CadBodyMode::NewBody;
        model.features.push_back(bodyB);model.features.push_back(fillet);
        const auto rounded=buildCad(model,.03);QCOMPARE(rounded.bodies.size(),size_t(2));
        QVERIFY(std::abs(rounded.bodies[0].volume-base.bodies[0].volume)>1e-6);QVERIFY(!rounded.bodies[0].edges.empty());
        model.sketches[0]=rectangle("Base",Plane::Front,12,8);
        QVERIFY_EXCEPTION_THROWN(buildCad(model,.03),std::runtime_error);
    }
    void centerlineEndpointConnectsToFullSplineInEitherOrder(){
        const Curve arch{"arch",{{0,0,0},{5,10,0},{10,0,0}}};
        const Vec3 onSpline{2.5,7.5,0}; // Quadratic midpoint, 2.5 units from the sampled chord.

        auto previous=buildNetwork({arch,{"untouched",{{20,0,0},{30,0,0}}}},1e-5);
        setBranchParameters(previous,1,4,.2,.3);
        const auto forward=addCenterlineWithSplineConnections(previous,{"stub",{onSpline,{2.5,7.5,5}}});
        QCOMPARE(forward.curves[0].points.size(),size_t(4));
        QVERIFY(pointNear(forward.curves[0].points[1],onSpline));
        QCOMPARE(forward.components,2);
        const auto preserved=std::find_if(forward.branches.begin(),forward.branches.end(),[](const Branch& branch) {
            return pointNear(branch.points.front(),{20,0,0})||pointNear(branch.points.back(),{20,0,0});
        });
        QVERIFY(preserved!=forward.branches.end());QCOMPARE(preserved->diameter,4.0);
        QCOMPARE(preserved->startSetback,.2);QCOMPARE(preserved->endSetback,.3);

        const auto reverse=addCenterlineWithSplineConnections(
            buildNetwork({{"stub",{onSpline,{2.5,7.5,5}}}},1e-5),arch);
        QCOMPARE(reverse.components,1);
        QCOMPARE(reverse.curves[1].points.size(),size_t(4));
        QVERIFY(pointNear(reverse.curves[1].points[1],onSpline));
    }
    void splineConnectionUsesThreeDimensionalDistance(){
        const Curve arch{"arch",{{0,0,0},{5,10,0},{10,0,0}}};
        const auto above=addCenterlineWithSplineConnections(
            buildNetwork({arch},1e-4),{"above",{{2.5,7.5,.1},{2.5,7.5,5}}});
        QCOMPARE(above.components,2);
        QCOMPARE(above.curves[0].points.size(),size_t(3));
        samePoint(above.curves[1].points.front(),{2.5,7.5,.1});

        // This point is exactly on a sampled chord but 2.5 units from the
        // full interpolant, so the chord fallback must not create a junction.
        const auto chordOnly=addCenterlineWithSplineConnections(
            buildNetwork({arch},1e-4),{"chord",{{2.5,5,0},{2.5,5,5}}});
        QCOMPARE(chordOnly.components,2);
        QCOMPARE(chordOnly.curves[0].points.size(),size_t(3));
    }
    void unequalDiameterYJunctionIsRejectedWithoutSphericalCore(){
        const auto result=buildVessels(yNetwork(3,.3),.02);
        QCOMPARE(result.branches.size(),size_t(3));QCOMPARE(result.junctions.size(),size_t(1));
        QCOMPARE(result.junctions[0].state,VesselBuildState::Failed);QVERIFY(result.nativeShape);
        QVERIFY(result.junctions[0].message.contains("equal daughter diameters",Qt::CaseInsensitive));
        for(const auto& triangle:result.triangles)QVERIFY(triangle.branch>=0);
    }
    void symmetricYJunctionBuildsSmoothWithoutSphericalCore(){
        const auto result=buildVessels(symmetricY(),.02);
        QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));
        QVERIFY(result.junctions[0].message.contains("smooth",Qt::CaseInsensitive));
        QVERIFY(result.junctions[0].maximumSeamAngle>=0);QVERIFY(result.junctions[0].maximumSeamAngle<1e-4);
        bool junctionTriangles=false;for(const auto& triangle:result.triangles)junctionTriangles|=triangle.branch==-1;
        QVERIFY(junctionTriangles);
    }
    void referenceStyleMotherAndEqualDaughtersBuildSmoothly(){
        const auto network=referenceStyleY();QElapsedTimer timer;timer.start();
        const auto result=buildVessels(network,.02);const auto coldNs=timer.nsecsElapsed();
        timer.restart();const auto repeated=buildVessels(network,.02);const auto warmNs=timer.nsecsElapsed();
        QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));
        QCOMPARE(result.nativeShape.get(),repeated.nativeShape.get());
        qInfo().noquote()<<QString("blended bifurcation exact-cache benchmark: cold %1 ms, warm %2 ms")
                             .arg(coldNs/1e6,0,'f',3).arg(warmNs/1e6,0,'f',3);
        QVERIFY(result.junctions[0].message.contains("smooth",Qt::CaseInsensitive));
        QVERIFY(result.junctions[0].maximumSeamAngle>=0);QVERIFY(result.junctions[0].maximumSeamAngle<1e-4);
        bool junctionTriangles=false;for(const auto& triangle:result.triangles)junctionTriangles|=triangle.branch==-1;
        QVERIFY(junctionTriangles);
    }
    void bifGeomReferenceCurvesBuildAndRemainMirrorSymmetric(){
        const auto network=bifGeomReferenceY();QElapsedTimer timer;timer.start();
        const auto result=buildVessels(network,.001);const auto coldNs=timer.nsecsElapsed();
        timer.restart();const auto repeated=buildVessels(network,.001);const auto warmNs=timer.nsecsElapsed();
        QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));
        qInfo().noquote()<<QString("BifGeom-style deflection 0.001 benchmark: cold %1 ms, warm %2 ms")
                             .arg(coldNs/1e6,0,'f',3).arg(warmNs/1e6,0,'f',3);
        qInfo()<<"BifGeom-style triangles"<<result.triangles.size();
        QCOMPARE(result.nativeShape.get(),repeated.nativeShape.get());
        QVERIFY(result.junctions[0].message.contains("symmetry-validated",Qt::CaseInsensitive));
        QVERIFY(result.junctions[0].maximumSeamAngle>=0);QVERIFY(result.junctions[0].maximumSeamAngle<1e-4);
        const std::vector<Vec3>* upper=nullptr;const std::vector<Vec3>* lower=nullptr;
        for(const auto& centerline:result.centerlines){
            const auto endpoint=std::abs(centerline.front().y)>std::abs(centerline.back().y)?centerline.front():centerline.back();
            if(endpoint.y>1)upper=&centerline;else if(endpoint.y<-1)lower=&centerline;
        }
        QVERIFY(upper!=nullptr);QVERIFY(lower!=nullptr);QCOMPARE(upper->size(),lower->size());
        const bool sameDirection=upper->front().x==lower->front().x;
        for(size_t i=0;i<upper->size();++i){
            const auto& a=(*upper)[i];const auto& b=(*lower)[sameDirection?i:lower->size()-1-i];
            QVERIFY(std::abs(a.x-b.x)<1e-9);QVERIFY(std::abs(a.y+b.y)<1e-9);QVERIFY(std::abs(a.z-b.z)<1e-9);
        }
    }
    void twoAssignedKinkFailsInsteadOfBuildingUnsmoothTransition(){
        const auto result=buildVessels(yNetwork(2),.02);
        QCOMPARE(result.junctions.size(),size_t(1));QCOMPARE(result.junctions[0].state,VesselBuildState::Failed);
        QVERIFY(result.junctions[0].message.contains("tangent-continuous",Qt::CaseInsensitive));
        QCOMPARE(result.branches[2].state,VesselBuildState::Provisional);
        QCOMPARE(result.centerlines.size(),size_t(3));for(const auto& line:result.centerlines) QVERIFY(line.size()>=2);
        for(const auto& triangle:result.triangles) QVERIFY(triangle.branch>=0);
    }
    void guidedPartialTransitionTracksCurvedSourceAndIsTangent(){
        const std::vector<Vec3> main{{-30,0,0},{-15,0,0},{0,0,0},{15,4,0},{30,10,0}};
        auto network=buildNetwork({{"main",main},{"side",{{0,0,0},{6,-15,0},{10,-30,0}}}});
        QCOMPARE(network.branches.size(),size_t(3));
        setBranchParameters(network,0,8,.1,.1);setBranchParameters(network,1,6,.1,.1);
        const auto result=buildVessels(network,.01);
        QCOMPARE(result.junctions.size(),size_t(1));
        const auto& junction=result.junctions.front();
        QVERIFY2(junction.state==VesselBuildState::Provisional,qPrintable(junction.message));
        QVERIFY(junction.message.contains("exact centerline-guided",Qt::CaseInsensitive));
        QVERIFY(junction.maximumSeamAngle>=0);QVERIFY(junction.maximumSeamAngle<1e-4);
        QVERIFY(junction.guide.size()>=17);
        double maximumDepartureFromSampleChords=0;
        for(const auto& value:junction.guide) {
            double nearest=std::numeric_limits<double>::infinity();
            for(size_t i=1;i<main.size();++i)
                nearest=std::min(nearest,distanceToSegment(value,main[i-1],main[i]));
            maximumDepartureFromSampleChords=std::max(maximumDepartureFromSampleChords,nearest);
        }
        QVERIFY(maximumDepartureFromSampleChords>.01);
    }
    void invalidJunctionRadiusFailsHonestly(){
        const auto result=buildVessels(yNetwork(3,.3),.02,2);
        QCOMPARE(result.junctions.size(),size_t(1));QCOMPARE(result.junctions[0].state,VesselBuildState::Failed);
        QVERIFY(result.nativeShape);QVERIFY(result.volume>0);
        for(const auto& triangle:result.triangles) QVERIFY(triangle.branch>=0);
    }
    void modestJunctionRoundBuilds(){
        const auto result=buildVessels(symmetricY(),.02,.1);
        QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));
        QVERIFY(result.junctions[0].message.contains("requested smooth",Qt::CaseInsensitive));
        bool roundedJunction=false;for(const auto& triangle:result.triangles) roundedJunction|=triangle.branch==-1;
        QVERIFY(roundedJunction);
    }
    void shortSetbackCannotContainUnequalJunctionCore(){
        const auto result=buildVessels(symmetricY(.05),.02);
        QCOMPARE(result.junctions.size(),size_t(1));QCOMPARE(result.junctions[0].state,VesselBuildState::Failed);
        QVERIFY(result.junctions[0].message.contains("setback",Qt::CaseInsensitive));
        for(const auto& triangle:result.triangles) QVERIFY(triangle.branch>=0);
    }
    void demoNetworkAssignedBranchesRemainSweepable(){
        auto network=demoNetwork();
        auto verify=[](const Network& source) {
            const auto result=buildVessels(source,.001);
            QCOMPARE(result.branches.size(),source.branches.size());
            for(size_t i=0;i<source.branches.size();++i) if(source.branches[i].diameter>0)
                QVERIFY2(result.branches[i].state==VesselBuildState::Built,
                         qPrintable(QString("%1: %2").arg(source.branches[i].id,result.branches[i].message)));
        };
        const auto original=network;
        const auto demo=buildVessels(original,.001);
        QCOMPARE(demo.junctions.size(),size_t(2));
        QCOMPARE(demo.junctions[0].index,3);QCOMPARE(demo.junctions[0].state,VesselBuildState::Failed);
        QVERIFY(demo.junctions[0].message.contains("tangent-continuous",Qt::CaseInsensitive));
        QCOMPARE(demo.junctions[1].index,6);QCOMPARE(demo.junctions[1].state,VesselBuildState::Failed);
        QVERIFY2(demo.junctions[1].message.contains("coplanar",Qt::CaseInsensitive),qPrintable(demo.junctions[1].message));
        verify(original);
        setBranchParameters(network,1,6.25,.15,.10);
        verify(network);
        verify(original);verify(network);
    }
};

QTEST_GUILESS_MAIN(CadTests)
#include "CadTests.moc"

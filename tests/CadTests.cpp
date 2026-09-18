#include "cad/CadModel.h"

#include <QTest>
#include <cmath>
#include <limits>
#include <numbers>
#include <utility>

using namespace mvcad;

namespace {

Sketch rectangle(QString id,Plane plane,double width,double height,double offset=0) {
    return {std::move(id),plane,offset,ProfileType::Rectangle,{{-width/2,-height/2},{width/2,height/2}},0};
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
    void unequalDiameterYJunctionBuildsValidJoinedVolume(){
        const auto result=buildVessels(yNetwork(3,.3),.02);
        QCOMPARE(result.branches.size(),size_t(3));QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));QVERIFY(result.nativeShape);
        QVERIFY(result.junctions[0].maximumSeamAngle>=0);QVERIFY(result.junctions[0].maximumSeamAngle<1e-4);
        QVERIFY(!result.junctions[0].guide.empty());
        const auto trimmedBranchVolume=std::numbers::pi*.7*(10*4+std::hypot(5.,8.)*(2.25+1));
        QVERIFY(std::isfinite(result.volume));QVERIFY(result.volume>trimmedBranchVolume);
        bool junctionTriangles=false;for(const auto& triangle:result.triangles) junctionTriangles|=triangle.branch==-1;
        QVERIFY(junctionTriangles);
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
        const auto result=buildVessels(yNetwork(3,.3),.02,.1);
        QCOMPARE(result.junctions.size(),size_t(1));
        QVERIFY2(result.junctions[0].state==VesselBuildState::Built,qPrintable(result.junctions[0].message));
        QVERIFY(result.junctions[0].message.contains("rounded",Qt::CaseInsensitive));
        bool roundedJunction=false;for(const auto& triangle:result.triangles) roundedJunction|=triangle.branch==-1;
        QVERIFY(roundedJunction);
    }
    void shortSetbackCannotContainUnequalJunctionCore(){
        const auto result=buildVessels(yNetwork(),.02);
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
        QCOMPARE(demo.junctions[1].index,6);QCOMPARE(demo.junctions[1].state,VesselBuildState::Built);
        QVERIFY(demo.junctions[1].message.contains("centerline-guided junction solid built",Qt::CaseInsensitive));
        verify(original);
        setBranchParameters(network,1,6.25,.15,.10);
        verify(network);
        verify(original);verify(network);
    }
};

QTEST_GUILESS_MAIN(CadTests)
#include "CadTests.moc"

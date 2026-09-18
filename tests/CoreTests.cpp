#include "core/Network.h"
#include "core/PartIO.h"
#include "core/Preview.h"
#include <QTest>
#include <QTemporaryDir>
#include <QFile>
#include <QJsonArray>
#include <limits>
using namespace mvcad;

class CoreTests:public QObject {
    Q_OBJECT
private slots:
    void csvOrdering(){
        auto curves=parseCsv("curve_id,x,y,z\na,0,0,0\nb,0,0,0\na,10,0,0\nb,0,10,0\n");
        QCOMPARE(curves.size(),size_t(2));QCOMPARE(curves[0].points[1].x,10.0);
    }
    void malformedCsv(){
        QVERIFY_EXCEPTION_THROWN(parseCsv("x,y,z\n0,0,0"),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(parseCsv("curve_id,x,y,z\na,nan,1,2"),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(parseCsv("curve_id,x,y,z\na,1,2"),std::runtime_error);
        auto invalid=QByteArray("curve_id,x,y,z\n")+QByteArray::fromHex("c3")+",1,2,3\n";
        QVERIFY_EXCEPTION_THROWN(parseCsv(invalid),std::runtime_error);
    }
    void splitAtSharedInteriorPoint(){
        auto n=buildNetwork({{"main",{{-10,0,0},{0,0,0},{10,0,0}}},{"side",{{0,0,0},{0,10,0}}}});
        QCOMPARE(n.branches.size(),size_t(3));QCOMPARE(n.components,1);QCOMPARE(junctionStates(n).size(),size_t(1));
    }
    void degreeTwoConnectionBecomesOneBranch(){
        auto n=buildNetwork({{"a",{{0,0,0},{10,0,0}}},{"b",{{10,0,0},{20,0,0}}}});
        QCOMPARE(n.branches.size(),size_t(1));QCOMPARE(n.branches[0].points.size(),size_t(3));
    }
    void threeDimensionalCrossingDoesNotConnect(){
        auto n=buildNetwork({{"a",{{-10,0,0},{10,0,0}}},{"b",{{0,-10,1},{0,10,1}}}});
        QCOMPARE(n.components,2);QCOMPARE(n.branches.size(),size_t(2));
    }
    void toleranceAcrossCellBoundary(){
        auto n=buildNetwork({{"a",{{-1,0,0},{.99e-6,0,0}}},{"b",{{1.01e-6,0,0},{1,0,0}}}},1e-6);
        QCOMPARE(n.components,1);QCOMPARE(n.branches.size(),size_t(1));
    }
    void closedLoop(){
        auto n=buildNetwork({{"loop",{{0,0,0},{10,0,0},{10,10,0},{0,10,0},{0,0,0}}}});
        QCOMPARE(n.branches.size(),size_t(1));QCOMPARE(n.branches[0].start,n.branches[0].end);
        QCOMPARE(junctionStates(n).size(),size_t(0));
    }
    void rejectDegenerateInput(){
        QVERIFY_EXCEPTION_THROWN(buildNetwork({{"a",{{0,0,0},{0,0,0}}}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(buildNetwork({{"a",{{0,0,0},{1,0,0}}},{"b",{{1,0,0},{0,0,0}}}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(buildNetwork({{"a",{{0,0,0},{1,0,0}}}},0),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(buildNetwork({{"a",{{0,0,0},{1e30,0,0}}}}),std::runtime_error);
        const auto high=std::numeric_limits<double>::max();
        QVERIFY_EXCEPTION_THROWN(buildNetwork({{"a",{{-high,0,0},{high,0,0}}}},high/8),std::runtime_error);
    }
    void invalidParametersAreTransactional(){
        auto n=demoNetwork();const auto before=serializePart(n);
        QVERIFY_EXCEPTION_THROWN(setBranchParameters(n,1,-1,.1,.1),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(setBranchParameters(n,1,6,.6,.5),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(setBranchParameters(n,1,std::numeric_limits<double>::infinity(),.1,.1),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(setBranchParameters(n,1,std::numeric_limits<double>::denorm_min(),.1,.1),std::runtime_error);
        QCOMPARE(serializePart(n),before);
    }
    void junctionAssignmentStatus(){
        auto n=demoNetwork();auto states=junctionStates(n);
        QCOMPARE(states.size(),size_t(2));QCOMPARE(states[0].incident,3);QCOMPARE(states[0].assigned,2);
        setBranchParameters(n,2,5,.1,.1);QCOMPARE(junctionStates(n)[0].assigned,3);
    }
    void splinePassesThroughPoints(){
        std::vector<Vec3> points{{0,0,0},{3,1,0},{7,-2,1},{10,0,0}};
        auto curve=interpolateCurve(points,8);QCOMPARE(curve.size(),size_t(25));
        for(size_t i=0;i<points.size();++i)QVERIFY((curve[i*8]-points[i]).length()<1e-10);
    }
    void splineHandlesLargeFiniteCoordinates(){
        const auto largeLength=Vec3{3e200,4e200,0}.length();
        QVERIFY(std::isfinite(largeLength));QVERIFY(std::abs(largeLength/5e200-1)<1e-15);
        const auto largeDirection=Vec3{0,1e300,1e300}.normalized();
        QVERIFY(largeDirection.finite());QVERIFY(std::abs(largeDirection.length()-1)<1e-15);
        const auto high=std::numeric_limits<double>::max();
        QVERIFY(std::isinf(Vec3{high,high,0}.length()));
        std::vector<Vec3> points{{1e200,0,0},{1e200,1e190,0},{1e200,2e190,1e190}};
        const auto curve=interpolateCurve(points,8);
        QCOMPARE(curve.front().x,points.front().x);QCOMPARE(curve.back().z,points.back().z);
        for(auto p:curve) QVERIFY(p.finite());
    }
    void tinyVectorNormalizationKeepsDirection(){
        const auto direction=Vec3{0,1e-300,0}.normalized();
        QCOMPARE(direction.x,0.0);QCOMPARE(direction.y,1.0);QCOMPARE(direction.z,0.0);
    }
    void trimUsesLengthNotPointCount(){
        auto p=trimByArcLength({{0,0,0},{1,0,0},{100,0,0}},.1,.2);
        QCOMPARE(p.front().x,10.0);QCOMPARE(p.back().x,80.0);
        QVERIFY_EXCEPTION_THROWN(trimByArcLength(p,std::numeric_limits<double>::quiet_NaN(),0),std::runtime_error);
    }
    void terminalBranchesAreNotTrimmed(){
        auto n=buildNetwork({{"a",{{0,0,0},{100,0,0}}}});setBranchParameters(n,0,8,.4,.4);
        auto mesh=makePreview(n);QVERIFY(!mesh.triangles.empty());
        double min=1e6,max=-1e6;for(auto t:mesh.triangles)for(auto p:{t.a,t.b,t.c}){min=std::min(min,p.x);max=std::max(max,p.x);}
        QCOMPARE(min,0.0);QCOMPARE(max,100.0);
    }
    void previewHasRequestedDiameter(){
        auto n=buildNetwork({{"a",{{0,0,0},{100,0,0}}}});setBranchParameters(n,0,8,.1,.1);
        auto mesh=makePreview(n);double r=0;for(auto t:mesh.triangles)for(auto p:{t.a,t.b,t.c}){QVERIFY(p.finite());r=std::max(r,std::hypot(p.y,p.z));}
        QVERIFY(std::abs(r-4)<1e-10);
    }
    void partRoundTripPreservesValues(){
        auto n=demoNetwork();setBranchParameters(n,1,6.123456789,.15,.075);
        QTemporaryDir dir;QVERIFY(dir.isValid());const auto path=dir.filePath("test.mvcad");savePart(path,n);
        auto loaded=loadPart(path);QCOMPARE(serializePart(loaded),serializePart(n));
    }
    void failedSaveDoesNotReplaceExistingPart(){
        auto n=demoNetwork();QTemporaryDir dir;QVERIFY(dir.isValid());const auto path=dir.filePath("test.mvcad");
        savePart(path,n);QFile beforeFile(path);QVERIFY(beforeFile.open(QIODevice::ReadOnly));const auto before=beforeFile.readAll();beforeFile.close();
        n.branches[0].diameter=std::numeric_limits<double>::infinity();
        QVERIFY_EXCEPTION_THROWN(savePart(path,n),std::runtime_error);
        QFile afterFile(path);QVERIFY(afterFile.open(QIODevice::ReadOnly));QCOMPARE(afterFile.readAll(),before);
    }
    void staleDerivedTopologyIsNotSerialized(){
        auto n=demoNetwork();n.nodes[0].degree=99;
        QVERIFY_EXCEPTION_THROWN(serializePart(n),std::runtime_error);
    }
    void tubeNormalsPointOutward(){
        auto n=buildNetwork({{"a",{{0,0,0},{100,0,0}}}});setBranchParameters(n,0,8,.1,.1);
        auto mesh=makePreview(n);const auto& t=mesh.triangles.front();
        const auto mid=(t.a+t.b+t.c)/3;
        QVERIFY((t.b-t.a).cross(t.c-t.a).dot({0,mid.y,mid.z})>0);
    }
    void emptyPartRoundTrip(){Network n;QCOMPARE(serializePart(deserializePart(serializePart(n))),serializePart(n));}
    void malformedParts(){
        auto obj=serializePart(demoNetwork());obj["schemaVersion"]=2;QVERIFY_EXCEPTION_THROWN(deserializePart(obj),std::runtime_error);
        obj=serializePart(demoNetwork());auto a=obj["branches"].toArray();auto b=a[0].toObject();b["diameter"]="bad";a[0]=b;obj["branches"]=a;
        QVERIFY_EXCEPTION_THROWN(deserializePart(obj),std::runtime_error);
        obj=serializePart(demoNetwork());obj["branches"]=QJsonArray{};QVERIFY_EXCEPTION_THROWN(deserializePart(obj),std::runtime_error);
    }
};
QTEST_GUILESS_MAIN(CoreTests)
#include "CoreTests.moc"

#include "core/Document.h"
#include "core/PartIO.h"
#include <QTest>
#include <QTemporaryDir>
#include <QFile>
using namespace mvcad;
class DocumentTests:public QObject{
    Q_OBJECT
private slots:
    void importIsPointsOnly(){auto points=parsePointsCsv("x,y,z\n0,0,0\n5,0,0\n10,0,0\n");QCOMPARE(points.size(),size_t(3));Document d;d.points=points;QVERIFY(d.network.curves.empty());QVERIFY(d.network.branches.empty());}
    void namedPointsAndInvalidCsv(){auto points=parsePointsCsv("point_id,x,y,z\nA,1,2,3\nB,4,5,6\n");QCOMPARE(points[0].id,QString("A"));QVERIFY_EXCEPTION_THROWN(parsePointsCsv("point_id,x,y,z\nA,0,0,0\nA,1,2,3"),std::runtime_error);QVERIFY_EXCEPTION_THROWN(parsePointsCsv("x,y,z\ninf,0,0"),std::runtime_error);}
    void interiorEndpointSplitsMainCurve(){auto n=connectCenterlines({{"main",{{-10,0,0},{10,0,0}}},{"side",{{0,0,0},{0,8,0}}}});QCOMPARE(n.branches.size(),size_t(3));QCOMPARE(n.components,1);QCOMPARE(junctionStates(n)[0].incident,3);QCOMPARE(n.curves[0].points.size(),size_t(3));}
    void unrelatedCrossingStaysDisconnected(){auto n=connectCenterlines({{"main",{{-10,0,0},{10,0,0}}},{"side",{{0,-10,2},{0,10,2}}}});QCOMPARE(n.components,2);QCOMPARE(n.branches.size(),size_t(2));}
    void preserveUnaffectedDiameter(){auto n=connectCenterlines({{"main",{{0,0,0},{10,0,0}}}});setBranchParameters(n,0,4,.1,.1);auto added=addCenterline(n,{"separate",{{20,0,0},{30,0,0}}});QCOMPARE(added.branches[0].diameter,4.0);}
    void cadAndPointRoundTrip(){Document d;d.points=parsePointsCsv("x,y,z\n0,0,0\n10,0,0");d.network=connectCenterlines({{"c",{{0,0,0},{10,0,0}}}});Sketch sketch;sketch.id="Sketch1";sketch.plane=Plane::Right;sketch.offset=2.5;sketch.profile=ProfileType::Circle;sketch.points={{1.25,2.75}};sketch.radius=3;d.cad.sketches.push_back(sketch);CadFeature feature;feature.id="Boss1";feature.sketch=0;feature.depth=7;feature.extent=CadExtent::MidPlane;d.cad.features.push_back(feature);QTemporaryDir dir;saveDocument(dir.filePath("part.mvcad"),d);auto loaded=loadDocument(dir.filePath("part.mvcad"));QCOMPARE(serializeDocument(loaded),serializeDocument(d));QVERIFY(std::abs(buildCad(loaded.cad).volume-buildCad(d.cad).volume)<1e-8);}
    void legacyPartLoads(){Document d=deserializeDocument(serializePart(demoNetwork()));QCOMPARE(d.network.branches.size(),size_t(5));QVERIFY(d.cad.features.empty());QVERIFY(d.points.empty());}
    void malformedDoesNotOverwrite(){Document d;d.points={{"p",{0,0,0}}};QTemporaryDir dir;auto path=dir.filePath("part.mvcad");saveDocument(path,d);d.points.push_back({"p",{1,0,0}});QVERIFY_EXCEPTION_THROWN(saveDocument(path,d),std::runtime_error);QCOMPARE(loadDocument(path).points.size(),size_t(1));}
    void precisionChangesPreviewResolution(){auto n=buildNetwork({{"c",{{0,0,0},{10,0,0}}}});setBranchParameters(n,0,6,0,0);auto coarse=makePreview(n,.01),fine=makePreview(n,.0001);QVERIFY(fine.triangles.size()>coarse.triangles.size());QCOMPARE(n.branches[0].diameter,6.0);QVERIFY_EXCEPTION_THROWN(makePreview(n,.00001),std::runtime_error);}
};
QTEST_GUILESS_MAIN(DocumentTests)
#include "DocumentTests.moc"

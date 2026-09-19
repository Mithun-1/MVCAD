#include "core/Document.h"
#include "core/PartIO.h"
#include <QTest>
#include <QTemporaryDir>
#include <QFile>
#include <QJsonArray>
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
    void richCadAndCurveDefinitionsRoundTrip(){
        Document d;d.points={{"P1",{-10,0,0}},{"P2",{0,4,0}},{"P3",{10,0,0}}};
        d.network=buildNetwork({{"Guide",{{-10,0,0},{0,4,0},{10,0,0}}}});
        d.curveDefinitions={{"Guide",{"P1","P2","P3"},false}};
        Sketch sketch;sketch.id="Base";sketch.profile=ProfileType::Rectangle;sketch.points={{-2,-3},{2,3}};d.cad.sketches.push_back(sketch);
        CadFeature boss;boss.id="BodyA";boss.sketch=0;boss.extent=CadExtent::TwoDirections;boss.depth=4;boss.secondDepth=2;boss.startOffset=1;boss.bodyMode=CadBodyMode::NewBody;d.cad.features.push_back(boss);
        CadFeature fillet;fillet.id="Fillet1";fillet.operation=CadOperation::Fillet;fillet.targetBody="BodyA";fillet.filletRadius=.5;fillet.edgeIds={"stable-edge-id"};d.cad.features.push_back(fillet);
        CadFeature remove;remove.id="Delete1";remove.operation=CadOperation::DeleteBody;remove.targetBody="BodyA";d.cad.features.push_back(remove);
        d.bodyDisplay={{"BodyA",true,.35},{"vessels",false,0}};
        const auto encoded=serializeDocument(d);QCOMPARE(encoded["schemaVersion"].toInt(),4);
        const auto loaded=deserializeDocument(encoded);QCOMPARE(serializeDocument(loaded),encoded);
        QCOMPARE(loaded.curveDefinitions.size(),size_t(1));QCOMPARE(loaded.curveDefinitions[0].pointIds[1],QString("P2"));
        QCOMPARE(loaded.cad.features[0].extent,CadExtent::TwoDirections);QCOMPARE(loaded.cad.features[0].secondDepth,2.0);
        QCOMPARE(loaded.cad.features[1].operation,CadOperation::Fillet);QCOMPARE(loaded.cad.features[1].edgeIds[0],QString("stable-edge-id"));
        QCOMPARE(loaded.cad.features[2].operation,CadOperation::DeleteBody);
        QCOMPARE(loaded.bodyDisplay.size(),size_t(2));QCOMPARE(loaded.bodyDisplay[1].opacity,0.0);
    }
    void schemaTwoLoadsWithNewDefaults(){
        Document original;Sketch sketch;sketch.id="Base";sketch.profile=ProfileType::Rectangle;sketch.points={{-1,-1},{1,1}};original.cad.sketches.push_back(sketch);
        CadFeature boss;boss.id="Boss1";boss.sketch=0;boss.depth=3;original.cad.features.push_back(boss);
        auto legacy=serializeDocument(original);legacy["schemaVersion"]=2;legacy.remove("curveDefinitions");legacy.remove("bodyDisplay");
        auto features=legacy["features"].toArray();auto feature=features[0].toObject();
        for(const auto* key:{"secondDepth","startOffset","bodyMode","targetBody","filletRadius","edgeIds"})feature.remove(QString::fromLatin1(key));
        features[0]=feature;legacy["features"]=features;
        const auto loaded=deserializeDocument(legacy);QVERIFY(loaded.curveDefinitions.empty());QVERIFY(loaded.bodyDisplay.empty());
        QCOMPARE(loaded.cad.features[0].secondDepth,0.0);QCOMPARE(loaded.cad.features[0].bodyMode,CadBodyMode::Merge);
        QVERIFY(buildCad(loaded.cad).volume>0);
    }
    void invalidCurveDefinitionsAndDisplayAreRejected(){
        Document d;d.points={{"P1",{0,0,0}},{"P2",{1,0,0}}};d.network=buildNetwork({{"C",{{0,0,0},{1,0,0}}}});
        d.curveDefinitions={{"C",{"P1","missing"},false}};QVERIFY_EXCEPTION_THROWN(serializeDocument(d),std::runtime_error);
        d.curveDefinitions={{"Wrong",{"P1","P2"},false}};QVERIFY_EXCEPTION_THROWN(serializeDocument(d),std::runtime_error);
        d.curveDefinitions={{"C",{"P1","P2"},false}};d.bodyDisplay={{"Body",false,1.1}};
        QVERIFY_EXCEPTION_THROWN(serializeDocument(d),std::runtime_error);
    }
    void reservedVesselBodyIdentifierIsRejected(){
        Document d;Sketch sketch;sketch.id="Base";sketch.profile=ProfileType::Rectangle;sketch.points={{-1,-1},{1,1}};d.cad.sketches.push_back(sketch);
        CadFeature feature;feature.id="vessels";feature.sketch=0;feature.depth=2;d.cad.features.push_back(feature);
        QVERIFY_EXCEPTION_THROWN(serializeDocument(d),std::runtime_error);
    }
    void legacyPartLoads(){Document d=deserializeDocument(serializePart(demoNetwork()));QCOMPARE(d.network.branches.size(),size_t(5));QVERIFY(d.cad.features.empty());QVERIFY(d.points.empty());}
    void malformedDoesNotOverwrite(){Document d;d.points={{"p",{0,0,0}}};QTemporaryDir dir;auto path=dir.filePath("part.mvcad");saveDocument(path,d);d.points.push_back({"p",{1,0,0}});QVERIFY_EXCEPTION_THROWN(saveDocument(path,d),std::runtime_error);QCOMPARE(loadDocument(path).points.size(),size_t(1));}
    void precisionChangesPreviewResolution(){auto n=buildNetwork({{"c",{{0,0,0},{10,0,0}}}});setBranchParameters(n,0,6,0,0);auto coarse=makePreview(n,.01),fine=makePreview(n,.0001);QVERIFY(fine.triangles.size()>coarse.triangles.size());QCOMPARE(n.branches[0].diameter,6.0);QVERIFY_EXCEPTION_THROWN(makePreview(n,.00001),std::runtime_error);}
};
QTEST_GUILESS_MAIN(DocumentTests)
#include "DocumentTests.moc"

#include "core/DocumentEditing.h"

#include <QJsonObject>
#include <QTest>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace {

using mvcad::Curve;
using mvcad::Document;
using mvcad::ImportedPoint;
using mvcad::Vec3;

const Curve* curveById(const Document& document, const QString& id) {
    const auto found = std::find_if(document.network.curves.begin(), document.network.curves.end(),
                                    [&](const Curve& curve) { return curve.id == id; });
    return found == document.network.curves.end() ? nullptr : &*found;
}

bool samePoint(const Vec3& a, const Vec3& b) {
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

class PointSetMirrorTests final : public QObject {
    Q_OBJECT

private slots:
    void appendPointSetRenamesDuplicatePointIdsAndPreservesExisting();
    void emptyPointSetThenManualPointsRoundTrip();
    void pointAndSetVisibility();
    void mirroredSourceAboutStraightTwoPointXYAxisIsSymmetricAndRetainsZ();
    void mirrorUpdatesAfterSourceEdit();
    void cyclicMirrorRejectsTransactionally();
    void schemaFourRoundTripAndSchemaThreeCompatibility();
};

void PointSetMirrorTests::appendPointSetRenamesDuplicatePointIdsAndPreservesExisting() {
    Document document;
    document.points = {{"P1", {0, 0, 0}}, {"P1_2", {1, 0, 0}}};

    mvcad::appendPointSet(document, "import", {{"P1", {2, 3, 4}}, {"P1", {5, 6, 7}}});

    QCOMPARE(document.points.size(), std::size_t(4));
    QCOMPARE(document.points[0].id, QString("P1"));
    QCOMPARE(document.points[1].id, QString("P1_2"));
    QCOMPARE(document.points[2].id, QString("P1_3"));
    QCOMPARE(document.points[3].id, QString("P1_4"));
    QCOMPARE(document.points[2].setId, QString("import"));
    QCOMPARE(document.points[3].setId, QString("import"));
    QCOMPARE(document.pointSets.size(), std::size_t(1));
    QCOMPARE(document.pointSets[0].id, QString("import"));
}

void PointSetMirrorTests::emptyPointSetThenManualPointsRoundTrip() {
    Document document;
    mvcad::appendPointSet(document, "empty", {});
    document.points.push_back({"manual", {1, 2, 3}, "empty", false});

    const auto encoded = mvcad::serializeDocument(document);
    const auto loaded = mvcad::deserializeDocument(encoded);

    QCOMPARE(loaded.pointSets.size(), std::size_t(1));
    QCOMPARE(loaded.pointSets[0].id, QString("empty"));
    QCOMPARE(loaded.points.size(), std::size_t(1));
    QCOMPARE(loaded.points[0].id, QString("manual"));
    QCOMPARE(loaded.points[0].setId, QString("empty"));
    QVERIFY(samePoint(loaded.points[0].position, {1, 2, 3}));
}

void PointSetMirrorTests::pointAndSetVisibility() {
    Document document;
    document.pointSets = {{"shown", false}, {"hidden", true}};
    document.points = {
        {"visible", {0, 0, 0}, "shown", false},
        {"setHidden", {1, 0, 0}, "hidden", false},
        {"pointHidden", {2, 0, 0}, "shown", true},
        {"unassigned", {3, 0, 0}, "", false},
    };
    document.network = mvcad::buildNetwork({{"curve", {{0, 0, 0}, {1, 0, 0}}}});

    QVERIFY(mvcad::pointVisible(document, document.points[0]));
    QVERIFY(!mvcad::pointVisible(document, document.points[1]));
    QVERIFY(!mvcad::pointVisible(document, document.points[2]));
    QVERIFY(mvcad::pointVisible(document, document.points[3]));
    QVERIFY(mvcad::branchCurveVisible(document, document.network.branches.front()));
    document.hiddenCurves = {"curve"};
    QVERIFY(!mvcad::branchCurveVisible(document, document.network.branches.front()));
}

void PointSetMirrorTests::mirroredSourceAboutStraightTwoPointXYAxisIsSymmetricAndRetainsZ() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A", {-1, 0, 0}}, {"B", {1, 0, 0}},
        {"S1", {2, 3, 7}}, {"S2", {4, 1, -2}},
    };
    document.curveDefinitions = {
        {"axis", {"A", "B"}, false},
        {"source", {"S1", "S2"}, false},
    };
    mvcad::regenerateCenterlines(document);
    mvcad::mirrorCenterline(document, "source", "axis", "mirrored");

    const auto* mirrored = curveById(document, "mirrored");
    QVERIFY(mirrored != nullptr);
    QCOMPARE(mirrored->points.size(), std::size_t(2));
    QVERIFY(samePoint(mirrored->points[0], {2, -3, 7}));
    QVERIFY(samePoint(mirrored->points[1], {4, -1, -2}));
}

void PointSetMirrorTests::mirrorUpdatesAfterSourceEdit() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A", {-1, 0, 0}}, {"B", {1, 0, 0}},
        {"S", {2, 3, 7}},
    };
    document.curveDefinitions = {
        {"axis", {"A", "B"}, false},
        {"source", {"S", "B"}, false},
    };
    mvcad::regenerateCenterlines(document);
    mvcad::mirrorCenterline(document, "source", "axis", "mirrored");

    document.points[2].position = {5, 4, 9};
    mvcad::regenerateCenterlines(document);
    const auto* mirrored = curveById(document, "mirrored");
    QVERIFY(mirrored != nullptr);
    QVERIFY(samePoint(mirrored->points.front(), {5, -4, 9}));
}

void PointSetMirrorTests::cyclicMirrorRejectsTransactionally() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {{"A", {-1, 0, 0}}, {"B", {1, 0, 0}}};
    document.curveDefinitions = {
        {"axis", {"A", "B"}, false},
        {"first", {}, false, "second", "axis"},
        {"second", {}, false, "first", "axis"},
    };
    const auto beforeDefinitions = document.curveDefinitions;
    const auto beforeNetwork = document.network;

    QVERIFY_EXCEPTION_THROWN(mvcad::regenerateCenterlines(document), std::runtime_error);
    QCOMPARE(document.curveDefinitions.size(), beforeDefinitions.size());
    QCOMPARE(document.curveDefinitions[1].mirrorSource, QString("second"));
    QCOMPARE(document.network.curves.size(), beforeNetwork.curves.size());
    QCOMPARE(document.network.branches.size(), beforeNetwork.branches.size());
}

void PointSetMirrorTests::schemaFourRoundTripAndSchemaThreeCompatibility() {
    Document document;
    document.pointSets = {{"set", true}};
    document.points = {{"P", {1, 2, 3}, "", false}};
    document.hiddenCurves = {"hidden"};

    const auto encoded = mvcad::serializeDocument(document);
    QCOMPARE(encoded["schemaVersion"].toInt(), 4);
    const auto loaded = mvcad::deserializeDocument(encoded);
    QCOMPARE(mvcad::serializeDocument(loaded), encoded);

    auto legacy = encoded;
    legacy["schemaVersion"] = 3;
    legacy.remove("pointSets");
    legacy.remove("hiddenCurves");
    const auto loadedLegacy = mvcad::deserializeDocument(legacy);
    QVERIFY(loadedLegacy.pointSets.empty());
    QVERIFY(loadedLegacy.hiddenCurves.empty());
    QCOMPARE(loadedLegacy.points.size(), std::size_t(1));
    QCOMPARE(loadedLegacy.points.front().id, QString("P"));
}

} // namespace

QTEST_GUILESS_MAIN(PointSetMirrorTests)
#include "PointSetMirrorTests.moc"

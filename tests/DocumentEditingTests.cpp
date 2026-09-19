#include "core/DocumentEditing.h"

#include <QtTest/QTest>
#include <QElapsedTimer>

#include <algorithm>
#include <cmath>
#include <limits>

namespace {

using mvcad::Branch;
using mvcad::Curve;
using mvcad::Document;
using mvcad::Vec3;

bool exactlyEqual(const Vec3& a, const Vec3& b) {
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

const Curve* curveById(const Document& document, const QString& id) {
    const auto it = std::find_if(document.network.curves.begin(), document.network.curves.end(),
                                 [&](const Curve& curve) { return curve.id == id; });
    return it == document.network.curves.end() ? nullptr : &*it;
}

int branchIndexWithEndpoints(const Document& document, const Vec3& a, const Vec3& b) {
    for (std::size_t i = 0; i < document.network.branches.size(); ++i) {
        const auto& points = document.network.branches[i].points;
        if (points.size() < 2) {
            continue;
        }
        if ((exactlyEqual(points.front(), a) && exactlyEqual(points.back(), b)) ||
            (exactlyEqual(points.front(), b) && exactlyEqual(points.back(), a))) {
            return static_cast<int>(i);
        }
    }
    return -1;
}

bool curveContains(const Curve& curve, const Vec3& point) {
    return std::any_of(curve.points.begin(), curve.points.end(),
                       [&](const Vec3& candidate) { return exactlyEqual(candidate, point); });
}

class DocumentEditingTests final : public QObject {
    Q_OBJECT

private slots:
    void sharedCurveVisibilityIsPreserved();
    void sharedDatumRegeneratesEveryDependentCurve();
    void unchangedBranchParametersSurviveAndModifiedBranchResets();
    void distantEditOnSplitSourceResetsEverySupportedBranch();
    void reversingUnchangedBranchSwapsSetbacks();
    void legacyCurvesPromoteToStableDatumReferences();
    void invalidRegenerationIsTransactional();
    void geometryFailureIsTransactional();
    void invalidPromotionIsTransactional();
    void nonfiniteDatumIsRejected();
    void duplicateDefinitionIdsAreRejectedTransactionally();
    void uniquePointIdsFillFirstAvailableSuffix();
    void batchRegenerationScalesToOneThousandCurves();
};

void DocumentEditingTests::sharedDatumRegeneratesEveryDependentCurve() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"L", {-10.0, 0.0, 0.0}},
        {"J", {0.0, 0.0, 0.0}},
        {"R", {10.0, 0.0, 0.0}},
        {"S", {0.0, 8.0, 0.0}},
    };
    document.curveDefinitions = {
        {"main", {"L", "J", "R"}, false},
        {"side", {"J", "S"}, false},
    };

    mvcad::regenerateCenterlines(document);
    QCOMPARE(document.network.curves.size(), std::size_t(2));
    QCOMPARE(document.network.components, 1);

    const Vec3 moved{1.0, 2.0, 3.0};
    document.points[1].position = moved;
    mvcad::regenerateCenterlines(document);

    const Curve* main = curveById(document, "main");
    const Curve* side = curveById(document, "side");
    QVERIFY(main != nullptr);
    QVERIFY(side != nullptr);
    QVERIFY(curveContains(*main, moved));
    QVERIFY(curveContains(*side, moved));
    QCOMPARE(document.network.components, 1);
}

void DocumentEditingTests::unchangedBranchParametersSurviveAndModifiedBranchResets() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A0", {0.0, 0.0, 0.0}},
        {"A1", {10.0, 0.0, 0.0}},
        {"B0", {20.0, 0.0, 0.0}},
        {"B1", {30.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {
        {"A", {"A0", "A1"}, false},
        {"B", {"B0", "B1"}, false},
    };
    mvcad::regenerateCenterlines(document);

    const int branchA = branchIndexWithEndpoints(document, {0, 0, 0}, {10, 0, 0});
    const int branchB = branchIndexWithEndpoints(document, {20, 0, 0}, {30, 0, 0});
    QVERIFY(branchA >= 0);
    QVERIFY(branchB >= 0);
    mvcad::setBranchParameters(document.network, branchA, 4.0, 0.2, 0.3);
    mvcad::setBranchParameters(document.network, branchB, 6.0, 0.4, 0.5);

    document.points[3].position = {31.0, 2.0, 0.0};
    mvcad::regenerateCenterlines(document);

    const int preservedIndex = branchIndexWithEndpoints(document, {0, 0, 0}, {10, 0, 0});
    const int changedIndex = branchIndexWithEndpoints(document, {20, 0, 0}, {31, 2, 0});
    QVERIFY(preservedIndex >= 0);
    QVERIFY(changedIndex >= 0);
    const Branch& preserved = document.network.branches[static_cast<std::size_t>(preservedIndex)];
    const Branch& changed = document.network.branches[static_cast<std::size_t>(changedIndex)];
    QCOMPARE(preserved.diameter, 4.0);
    QCOMPARE(preserved.startSetback, 0.2);
    QCOMPARE(preserved.endSetback, 0.3);
    QCOMPARE(changed.diameter, 0.0);
    QCOMPARE(changed.startSetback, 0.1);
    QCOMPARE(changed.endSetback, 0.1);
}

void DocumentEditingTests::reversingUnchangedBranchSwapsSetbacks() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A0", {0.0, 0.0, 0.0}},
        {"A1", {10.0, 2.0, 0.0}},
    };
    document.curveDefinitions = {{"A", {"A0", "A1"}, false}};
    mvcad::regenerateCenterlines(document);
    mvcad::setBranchParameters(document.network, 0, 5.0, 0.25, 0.5);

    std::reverse(document.curveDefinitions[0].pointIds.begin(),
                 document.curveDefinitions[0].pointIds.end());
    mvcad::regenerateCenterlines(document);

    QCOMPARE(document.network.branches.size(), std::size_t(1));
    const Branch& branch = document.network.branches.front();
    QVERIFY(exactlyEqual(branch.points.front(), Vec3{10.0, 2.0, 0.0}));
    QVERIFY(exactlyEqual(branch.points.back(), Vec3{0.0, 0.0, 0.0}));
    QCOMPARE(branch.diameter, 5.0);
    QCOMPARE(branch.startSetback, 0.5);
    QCOMPARE(branch.endSetback, 0.25);
}

void DocumentEditingTests::distantEditOnSplitSourceResetsEverySupportedBranch() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"L", {-10.0, 0.0, 0.0}},
        {"J", {0.0, 0.0, 0.0}},
        {"R", {10.0, 2.0, 0.0}},
        {"S", {0.0, 8.0, 0.0}},
        {"U", {20.0, 0.0, 0.0}},
        {"V", {30.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {
        {"main", {"L", "J", "R"}, false},
        {"side", {"J", "S"}, false},
        {"separate", {"U", "V"}, false},
    };
    mvcad::regenerateCenterlines(document);

    const int unchangedHalf = branchIndexWithEndpoints(document, {-10, 0, 0}, {0, 0, 0});
    const int separate = branchIndexWithEndpoints(document, {20, 0, 0}, {30, 0, 0});
    QVERIFY(unchangedHalf >= 0);
    QVERIFY(separate >= 0);
    mvcad::setBranchParameters(document.network, unchangedHalf, 4.0, 0.2, 0.3);
    mvcad::setBranchParameters(document.network, separate, 7.0, 0.4, 0.5);

    document.points[2].position = {11.0, 3.0, 0.0};
    mvcad::regenerateCenterlines(document);

    const int sameSampledHalf = branchIndexWithEndpoints(document, {-10, 0, 0}, {0, 0, 0});
    const int stillSeparate = branchIndexWithEndpoints(document, {20, 0, 0}, {30, 0, 0});
    QVERIFY(sameSampledHalf >= 0);
    QVERIFY(stillSeparate >= 0);
    QCOMPARE(document.network.branches[static_cast<std::size_t>(sameSampledHalf)].diameter, 0.0);
    QCOMPARE(document.network.branches[static_cast<std::size_t>(stillSeparate)].diameter, 7.0);
}

void DocumentEditingTests::legacyCurvesPromoteToStableDatumReferences() {
    Document document;
    document.network.tolerance = 0.01;
    document.network = mvcad::buildNetwork({
        {"open", {{0.0, 0.0, 0.0}, {10.0, 0.0, 0.0}}},
        {"loop", {{0.0, 10.0, 0.0}, {5.0, 12.0, 0.0}, {10.0, 10.0, 0.0},
                  {0.0, 10.0, 0.0}}},
    }, document.network.tolerance);
    document.points = {
        {"Existing", {0.005, 0.0, 0.0}},
        {"PNT0001", {100.0, 100.0, 100.0}},
    };
    const auto originalCurves = document.network.curves;

    mvcad::ensureCurveDefinitions(document);

    QCOMPARE(document.curveDefinitions.size(), std::size_t(2));
    QCOMPARE(document.curveDefinitions[0].id, QString("open"));
    QCOMPARE(document.curveDefinitions[0].pointIds.front(), QString("Existing"));
    QCOMPARE(document.curveDefinitions[0].pointIds.back(), QString("PNT0002"));
    QCOMPARE(document.curveDefinitions[1].id, QString("loop"));
    QVERIFY(document.curveDefinitions[1].closed);
    QCOMPARE(document.curveDefinitions[1].pointIds.size(), std::size_t(3));
    QCOMPARE(document.network.curves.size(), originalCurves.size());
    for (std::size_t i = 0; i < originalCurves.size(); ++i) {
        QCOMPARE(document.network.curves[i].id, originalCurves[i].id);
        QCOMPARE(document.network.curves[i].points.size(), originalCurves[i].points.size());
        for (std::size_t j = 0; j < originalCurves[i].points.size(); ++j) {
            QVERIFY(exactlyEqual(document.network.curves[i].points[j], originalCurves[i].points[j]));
        }
    }

    const auto pointCount = document.points.size();
    const auto definitions = document.curveDefinitions;
    mvcad::ensureCurveDefinitions(document);
    QCOMPARE(document.points.size(), pointCount);
    QCOMPARE(document.curveDefinitions.size(), definitions.size());
    QVERIFY(document.curveDefinitions[1].pointIds == definitions[1].pointIds);
}

void DocumentEditingTests::invalidRegenerationIsTransactional() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A", {0.0, 0.0, 0.0}},
        {"B", {10.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {{"line", {"A", "B"}, false}};
    mvcad::regenerateCenterlines(document);
    mvcad::setBranchParameters(document.network, 0, 3.0, 0.2, 0.4);
    document.curveDefinitions[0].pointIds[1] = "missing";

    const auto beforePoints = document.points;
    const auto beforeDefinitions = document.curveDefinitions;
    const auto beforeNetwork = document.network;
    QVERIFY_EXCEPTION_THROWN(mvcad::regenerateCenterlines(document), std::runtime_error);

    QCOMPARE(document.points.size(), beforePoints.size());
    QVERIFY(document.curveDefinitions[0].pointIds == beforeDefinitions[0].pointIds);
    QCOMPARE(document.network.curves.size(), beforeNetwork.curves.size());
    QCOMPARE(document.network.branches.size(), beforeNetwork.branches.size());
    QCOMPARE(document.network.branches[0].diameter, beforeNetwork.branches[0].diameter);
    QCOMPARE(document.network.branches[0].startSetback, beforeNetwork.branches[0].startSetback);
    QCOMPARE(document.network.branches[0].endSetback, beforeNetwork.branches[0].endSetback);
}

void DocumentEditingTests::invalidPromotionIsTransactional() {
    Document document;
    document.network.tolerance = 1e-6;
    document.network.curves = {
        {"good", {{0.0, 0.0, 0.0}, {1.0, 0.0, 0.0}}},
        {"bad", {{2.0, 0.0, 0.0}, {std::numeric_limits<double>::infinity(), 0.0, 0.0}}},
    };
    document.points = {{"PNT0001", {100.0, 100.0, 100.0}}};
    const auto beforeCurves = document.network.curves;
    const auto beforePoints = document.points;

    QVERIFY_EXCEPTION_THROWN(mvcad::ensureCurveDefinitions(document), std::runtime_error);
    QVERIFY(document.curveDefinitions.empty());
    QCOMPARE(document.points.size(), beforePoints.size());
    QCOMPARE(document.points.front().id, QString("PNT0001"));
    QCOMPARE(document.network.curves.size(), beforeCurves.size());
    QVERIFY(std::isinf(document.network.curves[1].points[1].x));
}

void DocumentEditingTests::geometryFailureIsTransactional() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A", {0.0, 0.0, 0.0}},
        {"B", {1.0, 0.0, 0.0}},
        {"C", {2.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {{"valid", {"A", "B"}, false}};
    mvcad::regenerateCenterlines(document);
    document.curveDefinitions.push_back({"degenerate", {"C", "C"}, false});
    const auto beforeCurves = document.network.curves;
    const auto beforeBranches = document.network.branches;

    QVERIFY_EXCEPTION_THROWN(mvcad::regenerateCenterlines(document), std::runtime_error);
    QCOMPARE(document.network.curves.size(), beforeCurves.size());
    QCOMPARE(document.network.branches.size(), beforeBranches.size());
    QCOMPARE(document.curveDefinitions.size(), std::size_t(2));
    QCOMPARE(document.curveDefinitions[1].id, QString("degenerate"));
}

void DocumentEditingTests::nonfiniteDatumIsRejected() {
    Document document;
    document.points = {
        {"A", {std::numeric_limits<double>::quiet_NaN(), 0.0, 0.0}},
        {"B", {1.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {{"line", {"A", "B"}, false}};

    QVERIFY_EXCEPTION_THROWN(mvcad::regenerateCenterlines(document), std::runtime_error);
    QVERIFY(std::isnan(document.points.front().position.x));
    QVERIFY(document.network.curves.empty());
}

void DocumentEditingTests::duplicateDefinitionIdsAreRejectedTransactionally() {
    Document document;
    document.network.tolerance = 1e-6;
    document.points = {
        {"A", {0.0, 0.0, 0.0}},
        {"B", {1.0, 0.0, 0.0}},
        {"C", {2.0, 0.0, 0.0}},
    };
    document.curveDefinitions = {
        {"duplicate", {"A", "B"}, false},
        {"duplicate", {"B", "C"}, false},
    };
    const auto before = document;

    QVERIFY_EXCEPTION_THROWN(mvcad::regenerateCenterlines(document), std::runtime_error);
    QCOMPARE(document.curveDefinitions.size(), before.curveDefinitions.size());
    QCOMPARE(document.curveDefinitions[0].id, before.curveDefinitions[0].id);
    QCOMPARE(document.curveDefinitions[1].id, before.curveDefinitions[1].id);
    QVERIFY(document.network.curves.empty());
}

void DocumentEditingTests::uniquePointIdsFillFirstAvailableSuffix() {
    Document document;
    document.points = {
        {"PNT0001", {0, 0, 0}},
        {"PNT0003", {0, 0, 0}},
        {"Datum0001", {0, 0, 0}},
    };
    QCOMPARE(mvcad::uniquePointId(document), QString("PNT0002"));
    QCOMPARE(mvcad::uniquePointId(document, "Datum"), QString("Datum0002"));
    QCOMPARE(mvcad::uniquePointId(document, ""), QString("PNT0002"));
}

void DocumentEditingTests::batchRegenerationScalesToOneThousandCurves(){
    Document document;document.network.tolerance=1e-6;
    document.points.reserve(2000);document.curveDefinitions.reserve(1000);
    for(int i=0;i<1000;++i){
        const auto a=QString("A%1").arg(i),b=QString("B%1").arg(i);
        document.points.push_back({a,{0,double(i)*4,0}});
        document.points.push_back({b,{10,double(i)*4,0}});
        document.curveDefinitions.push_back({QString("curve-%1").arg(i),{a,b},false});
    }
    QElapsedTimer timer;timer.start();mvcad::regenerateCenterlines(document);const auto elapsedMs=timer.nsecsElapsed()/1e6;
    QCOMPARE(document.network.curves.size(),size_t(1000));QCOMPARE(document.network.branches.size(),size_t(1000));
    QCOMPARE(document.network.components,1000);
    qInfo().noquote()<<QString("regenerate 1000 independent centerlines: %1 ms").arg(elapsedMs,0,'f',3);
    QVERIFY2(elapsedMs<15000,qPrintable(QString("Batch regeneration took %1 ms").arg(elapsedMs,0,'f',1)));
}

void DocumentEditingTests::sharedCurveVisibilityIsPreserved(){
    Document document;
    // Visibility must also handle legacy/imported sources that share an edge.
    // buildNetwork intentionally rejects duplicate sampled edges, so model the
    // already-established topology directly for this display-only regression.
    document.network.tolerance=1e-6;
    document.network.curves={{"first",{{0,0,0},{10,0,0},{20,0,0}}},
                             {"second",{{10,0,0},{20,0,0},{30,5,0}}},
                             {"spur",{{10,0,0},{10,10,0}}}};
    document.network.nodes={{{0,0,0},1},{{10,0,0},3},{{20,0,0},2},{{30,5,0},1},{{10,10,0},1}};
    document.network.branches={{"B001",{{0,0,0},{10,0,0}},0,1},
                               {"B002",{{10,0,0},{20,0,0},{30,5,0}},1,3},
                               {"B003",{{10,0,0},{10,10,0}},1,4}};
    document.network.components=1;
    document.hiddenCurves={"first"};
    auto flags=mvcad::branchCurveVisibility(document);
    for(size_t i=0;i<flags.size();++i)QCOMPARE(flags[i],mvcad::branchCurveVisible(document,document.network.branches[i]));
    QVERIFY(std::any_of(flags.begin(),flags.end(),[](bool v){return v;}));
    QVERIFY(std::any_of(flags.begin(),flags.end(),[](bool v){return !v;}));
    document.hiddenCurves.push_back("second");document.hiddenCurves.push_back("spur");flags=mvcad::branchCurveVisibility(document);
    for(bool visible:flags)QVERIFY(!visible);
    document.hiddenCurves.clear();flags=mvcad::branchCurveVisibility(document);
    for(bool visible:flags)QVERIFY(visible);
}

} // namespace

QTEST_GUILESS_MAIN(DocumentEditingTests)
#include "DocumentEditingTests.moc"

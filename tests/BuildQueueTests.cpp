#include "app/GeometryBuildQueue.h"
#include <QTest>
#include <QTimer>
#include <numbers>
using namespace mvcad;
class BuildQueueTests:public QObject {
    Q_OBJECT
private slots:
    void latestRequestWinsWithoutBlockingEventLoop(){
        std::vector<Curve> curves;for(int i=0;i<100;++i)curves.push_back({QString::number(i),{{0.,double(i*10),0.},{20.,double(i*10),0.}}});
        auto network=buildNetwork(curves);for(auto& branch:network.branches)branch.diameter=2;
        GeometryBuildQueue queue;int completions=0,ticks=0;GeometryBuildQueue::Result result;
        queue.completed=[&](const auto& value){++completions;result=value;};
        QTimer heartbeat;connect(&heartbeat,&QTimer::timeout,this,[&]{++ticks;});heartbeat.start(1);
        queue.request(network,.001,0);QTRY_COMPARE_WITH_TIMEOUT(queue.buildCount(),quint64(1),5000);
        quint64 latest=0;for(int i=0;i<20;++i){network.branches[0].diameter=3.+i/10.;latest=queue.request(network,.001,0);}
        QTRY_VERIFY_WITH_TIMEOUT(!queue.busy(),30000);
        QCOMPARE(result.revision,latest);QVERIFY(result.error.isEmpty());QVERIFY(result.geometry&&result.geometry->nativeShape);
        QVERIFY(queue.buildCount()<=2);QVERIFY(ticks>2);QVERIFY(completions<=2);
        const auto expected=(99.+std::pow(4.9/2,2))*std::numbers::pi*20.;
        QVERIFY(std::abs(result.geometry->volume-expected)/expected<1e-6);
    }
    void destructionWaitsSafelyForWorker(){
        auto network=buildNetwork({{"one",{{0,0,0},{10,0,0}}}});network.branches[0].diameter=2;
        int callbacks=0;{GeometryBuildQueue queue;queue.completed=[&](const auto&){++callbacks;};queue.request(network,.001,0);QCoreApplication::processEvents();}
        QCOMPARE(callbacks,0);
    }
};
QTEST_GUILESS_MAIN(BuildQueueTests)
#include "BuildQueueTests.moc"

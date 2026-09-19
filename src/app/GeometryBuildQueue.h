#pragma once
#include "cad/CadModel.h"
#include <QObject>
#include <QFutureWatcher>
#include <QThreadPool>
#include <functional>
#include <optional>

// One worker owns kernel execution. Edits arriving during a build replace the
// queued request; only the newest revision can become visible in the viewport.
class GeometryBuildQueue final:public QObject {
public:
    struct Result {
        quint64 revision=0;
        std::shared_ptr<const mvcad::VesselResult> geometry;
        QString error;
        double milliseconds=0;
    };
    explicit GeometryBuildQueue(QObject* parent=nullptr);
    ~GeometryBuildQueue() override;
    quint64 request(mvcad::Network network,double precision,double radius);
    bool busy()const{return running_||pending_.has_value();}
    quint64 buildCount()const{return buildCount_;}
    std::function<void(const Result&)> completed;
private:
    struct Request {mvcad::Network network;double precision,radius;quint64 revision;};
    QThreadPool pool_;
    QFutureWatcher<Result> watcher_;
    std::optional<Request> pending_;
    quint64 revision_=0,buildCount_=0;
    bool running_=false;
    void startLatest();
};

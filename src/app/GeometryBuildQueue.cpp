#include "GeometryBuildQueue.h"
#include <QtConcurrent/QtConcurrentRun>
#include <QElapsedTimer>
#include <QTimer>
#include <exception>

GeometryBuildQueue::GeometryBuildQueue(QObject* parent):QObject(parent){
    pool_.setMaxThreadCount(1);
    connect(&watcher_,&QFutureWatcher<Result>::finished,this,[this]{
        auto result=watcher_.result();running_=false;
        if(result.revision==revision_&&completed)completed(result);
        startLatest();
    });
}
GeometryBuildQueue::~GeometryBuildQueue(){
    completed={};disconnect(&watcher_,nullptr,this,nullptr);pending_.reset();
    pool_.waitForDone();
}
quint64 GeometryBuildQueue::request(mvcad::Network network,double precision,double radius){
    pending_=Request{std::move(network),precision,radius,++revision_};
    QTimer::singleShot(0,this,[this]{startLatest();});return revision_;
}
void GeometryBuildQueue::startLatest(){
    if(running_||!pending_)return;
    auto request=std::move(*pending_);pending_.reset();running_=true;++buildCount_;
    watcher_.setFuture(QtConcurrent::run(&pool_,[request=std::move(request)]{
        Result result;result.revision=request.revision;QElapsedTimer timer;timer.start();
        try{result.geometry=std::make_shared<mvcad::VesselResult>(mvcad::buildVessels(request.network,request.precision,request.radius));}
        catch(const std::exception& error){result.error=QString::fromUtf8(error.what());}
        catch(...){result.error="The geometry engine could not complete this build.";}
        result.milliseconds=timer.nsecsElapsed()/1e6;return result;
    }));
}

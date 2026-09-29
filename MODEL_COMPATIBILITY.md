# SENTINEL PULSE model compatibility

The bundled `backend/model_bundle.joblib` was serialized with scikit-learn **1.8.0**. The artifact embeds `_sklearn_version: 1.8.0`.

Do not load the bundled artifact with a different scikit-learn major/minor version. `backend/requirements.txt` therefore pins `scikit-learn==1.8.0`.

If the model is retrained, record the exact Python and ML dependency versions in model metadata and regenerate the lock/deployment image together with the model artifact.

This bundled model uses synthetic development data and is for SIH demonstration only. It is not validated for operational or clinical use.
